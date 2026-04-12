import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { getBenchmarkState, listBenchmarkTasks, resetBenchmark, stepBenchmark } from './benchmark';

type DetectionResult = {
  detections: Array<{
    label: string;
    confidence: number;
    x: number;
    y: number;
    w: number;
    h: number;
    id: string;
  }>;
  hasAmbulance: boolean;
  note: string;
  stale?: boolean;
};

type WorkerMessage =
  | { ready: true; weights: string; custom: boolean }
  | { id: string | null; ok: true; result: DetectionResult }
  | { id: string | null; ok: false; error: string };

type PendingRequest = {
  resolve: (value: DetectionResult) => void;
  reject: (reason?: unknown) => void;
  timeoutId: NodeJS.Timeout;
  cacheKey: string;
  workerIndex: number;
};

type WorkerEntry = {
  process: ChildProcessWithoutNullStreams;
  readyPromise: Promise<void>;
  busyCount: number;
  ready: boolean;
  dispatchChain: Promise<void>;
};

type PythonLauncher = {
  command: string;
  args: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const app = express();
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const allowedVideoPattern = /^video[1-8]\.mp4$/i;
const allowedVideos = Array.from({ length: 8 }, (_, index) => `video${index + 1}.mp4`);
const lastSuccessfulDetections = new Map<string, DetectionResult>();
const lastDetectionByVideo = new Map<string, { timestamp: number; result: DetectionResult }>();
const inFlightDetections = new Map<string, Promise<DetectionResult>>();
const pendingRequests = new Map<string, PendingRequest>();
const workerPool: Array<WorkerEntry | null> = [];
const videoWorkerAffinity = new Map<string, number>();
const detectedWorkerCount = (() => {
  const explicit = Number(process.env.DETECTOR_WORKERS ?? '');
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(3, cpuCount));
})();
const workerPoolSize = detectedWorkerCount;
const CACHE_BUCKETS_PER_SECOND = Math.max(1, Number(process.env.DETECTION_CACHE_BUCKETS_PER_SECOND ?? 3));
const STALE_VIDEO_FALLBACK_SECONDS = Math.max(2.5, Number(process.env.STALE_VIDEO_FALLBACK_SECONDS ?? 3.5));
const DETECTION_WORKER_TIMEOUT_MS = Math.max(12000, Number(process.env.DETECTION_WORKER_TIMEOUT_MS ?? 22000));
const PREFETCH_ENABLED = process.env.DETECTION_PREFETCH === 'true';
const PRIME_CACHE_ON_STARTUP = process.env.DETECTION_PRIME_CACHE !== 'false';
const LIVE_EMPTY_FALLBACK_NOTE = 'Detector is still catching up. Keeping the live stream active with the last stable state.';
const PRIMED_FRAME_TIME_BY_VIDEO: Record<string, number> = {
  'video1.mp4': 0.5,
  'video2.mp4': 0.5,
  'video3.mp4': 0.5,
  'video4.mp4': 0.5,
  'video5.mp4': 0.8,
  'video6.mp4': 0.8,
  'video7.mp4': 0.7,
  'video8.mp4': 0.6,
};

let workerSequence = 0;
let warmedWorkers = 0;

function resolvePythonLauncher(): PythonLauncher {
  const configured = process.env.PYTHON_BIN?.trim();
  const candidates: PythonLauncher[] = [];

  if (configured) {
    candidates.push({ command: configured, args: [] });
  }

  candidates.push({ command: 'python3', args: [] });
  candidates.push({ command: 'python', args: [] });

  if (process.platform === 'win32') {
    candidates.push({ command: 'py', args: ['-3'] });
  }

  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate.command, [...candidate.args, '--version'], {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: 10000,
      });
      if (probe.status === 0) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    'No working Python interpreter was found. Set PYTHON_BIN to a valid Python executable before starting the detector server.'
  );
}

const pythonLauncher = resolvePythonLauncher();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json());

function staleResult(cacheKey: string): DetectionResult | null {
  const cached = lastSuccessfulDetections.get(cacheKey);
  return cached
    ? {
        ...cached,
        stale: true,
        note: 'Using last stable detection while the detector catches up.',
      }
    : null;
}

function staleVideoResult(video: string, timestamp: number): DetectionResult | null {
  const cached = lastDetectionByVideo.get(video);
  if (!cached) {
    return null;
  }

  if (Math.abs(cached.timestamp - timestamp) > STALE_VIDEO_FALLBACK_SECONDS) {
    return null;
  }

  return {
    ...cached.result,
    stale: true,
    note: 'Streaming the latest stable detections while a fresh frame is processed.',
  };
}

function parseLiveCacheKey(cacheKey: string): { video: string; timestamp: number } | null {
  const parts = cacheKey.split(':');
  if (parts.length !== 2) {
    return null;
  }

  const [video, timestampText] = parts;
  const timestamp = Number(timestampText);
  if (!video || !Number.isFinite(timestamp)) {
    return null;
  }

  return { video, timestamp };
}

function hasVideoRequestInFlight(video: string): boolean {
  for (const pending of pendingRequests.values()) {
    const liveCacheKey = parseLiveCacheKey(pending.cacheKey);
    if (liveCacheKey?.video === video) {
      return true;
    }
  }

  return false;
}

function quantizeTimestamp(timestamp: number): number {
  return Math.floor(timestamp * CACHE_BUCKETS_PER_SECOND) / CACHE_BUCKETS_PER_SECOND;
}

function prefetchVideoFrame(video: string, timestamp: number) {
  if (!PREFETCH_ENABLED || !allowedVideoPattern.test(video)) {
    return;
  }

  const normalizedTimestamp = quantizeTimestamp(timestamp);
  const cacheKey = `${video}:${normalizedTimestamp}`;
  if (lastSuccessfulDetections.has(cacheKey) || inFlightDetections.has(cacheKey)) {
    return;
  }

  void runDetector(video, normalizedTimestamp, cacheKey).catch(() => {
    // Prefetch is best-effort only.
  });
}

async function primeDetectionCache() {
  await Promise.all(
    allowedVideos.map((video) => {
      const timestamp = quantizeTimestamp(PRIMED_FRAME_TIME_BY_VIDEO[video] ?? 0.5);
      return runDetector(video, timestamp, `${video}:${timestamp}`).catch(() => {
        // Startup priming should not block the server if a sample frame fails.
      });
    })
  );
}

function resolvePendingRequest(id: string, result: DetectionResult) {
  const pending = pendingRequests.get(id);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingRequests.delete(id);
  const worker = workerPool[pending.workerIndex];
  if (worker) {
    worker.busyCount = Math.max(0, worker.busyCount - 1);
  }
  lastSuccessfulDetections.set(pending.cacheKey, result);
  const liveCacheKey = parseLiveCacheKey(pending.cacheKey);
  if (liveCacheKey) {
    lastDetectionByVideo.set(liveCacheKey.video, {
      timestamp: liveCacheKey.timestamp,
      result,
    });
  }
  pending.resolve(result);
}

function rejectPendingRequest(id: string, error: string) {
  const pending = pendingRequests.get(id);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingRequests.delete(id);
  const worker = workerPool[pending.workerIndex];
  if (worker) {
    worker.busyCount = Math.max(0, worker.busyCount - 1);
  }

  const fallback = staleResult(pending.cacheKey);
  if (fallback) {
    pending.resolve(fallback);
    return;
  }

  pending.reject(new Error(error));
}

function cleanupWorker(workerIndex: number, errorMessage: string) {
  for (const [id, pending] of pendingRequests.entries()) {
    if (pending.workerIndex === workerIndex) {
      rejectPendingRequest(id, errorMessage);
    }
  }

  for (const [video, assignedWorkerIndex] of videoWorkerAffinity.entries()) {
    if (assignedWorkerIndex === workerIndex) {
      videoWorkerAffinity.delete(video);
    }
  }

  workerPool[workerIndex] = null;
}

function handleWorkerMessage(message: WorkerMessage) {
  if ('ready' in message) {
    return;
  }

  if (!message.id) {
    return;
  }

  if (message.ok === true) {
    resolvePendingRequest(message.id, message.result);
    return;
  }

  rejectPendingRequest(message.id, message.error);
}

function startWorker(workerIndex: number): WorkerEntry {
  const workerProcess = spawn(pythonLauncher.command, [...pythonLauncher.args, '-u', 'ml/scripts/detect_worker.py'], {
    cwd: rootDir,
  });

  const readyPromise = new Promise<void>((resolve, reject) => {
    let resolved = false;
    const startupLogs: string[] = [];

    const readyTimer = setTimeout(() => {
      if (!resolved) {
        cleanupWorker(workerIndex, startupLogs.join(' ') || `Detector worker ${workerIndex} timed out while starting.`);
        workerProcess.kill();
        reject(new Error(startupLogs.join(' ') || `Detector worker ${workerIndex} timed out while starting.`));
      }
    }, 120000);

    const stdoutReader = readline.createInterface({ input: workerProcess.stdout });
    const stderrReader = readline.createInterface({ input: workerProcess.stderr });

    stdoutReader.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        const message = JSON.parse(trimmed) as WorkerMessage;
        if ('ready' in message && message.ready) {
          if (!resolved) {
            const worker = workerPool[workerIndex];
            if (worker) {
              worker.ready = true;
            }
            resolved = true;
            clearTimeout(readyTimer);
            warmedWorkers = Math.max(warmedWorkers, workerIndex + 1);
            resolve();
          }
          return;
        }

        handleWorkerMessage(message);
      } catch {
        if (!resolved) {
          startupLogs.push(trimmed);
        }
      }
    });

    stderrReader.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      if (!resolved) {
        startupLogs.push(trimmed);
      }
    });

    workerProcess.on('error', (error) => {
      clearTimeout(readyTimer);
      cleanupWorker(workerIndex, `Failed to start detector worker ${workerIndex}: ${error.message}`);
      if (!resolved) {
        reject(new Error(`Failed to start detector worker ${workerIndex}: ${error.message}`));
      }
    });

    workerProcess.on('close', (code) => {
      clearTimeout(readyTimer);
      cleanupWorker(
        workerIndex,
        code === 0
          ? `Detector worker ${workerIndex} closed unexpectedly.`
          : `Detector worker ${workerIndex} exited with code ${code}.`
      );
      if (!resolved) {
        reject(
          new Error(
            startupLogs.join(' ') ||
              (code === 0
                ? `Detector worker ${workerIndex} closed unexpectedly.`
                : `Detector worker ${workerIndex} exited with code ${code}.`)
          )
        );
      }
    });
  });

  return {
    process: workerProcess,
    readyPromise,
    busyCount: 0,
    ready: false,
    dispatchChain: Promise.resolve(),
  };
}

function enqueueWorkerTask<T>(workerIndex: number, task: () => Promise<T>): Promise<T> {
  const worker = workerPool[workerIndex];
  if (!worker) {
    return Promise.reject(new Error(`Detector worker ${workerIndex} is not available.`));
  }

  const scheduledTask = worker.dispatchChain.then(task, task);
  worker.dispatchChain = scheduledTask.then(
    () => undefined,
    () => undefined
  );

  return scheduledTask;
}

function ensureWorker(workerIndex: number): Promise<void> {
  let worker = workerPool[workerIndex];
  if (!worker) {
    worker = startWorker(workerIndex);
    workerPool[workerIndex] = worker;
  }
  return worker.readyPromise.catch((error) => {
    if (workerPool[workerIndex] === worker) {
      workerPool[workerIndex] = null;
    }
    throw error;
  });
}

async function ensureWorkerPool(): Promise<void> {
  await Promise.all(Array.from({ length: workerPoolSize }, (_, index) => ensureWorker(index)));
}

function getWorkerIndexForVideo(video: string): number {
  const readyWorkerIndexes = Array.from({ length: workerPoolSize }, (_unused, index) => index).filter(
    (index) => workerPool[index]?.ready
  );

  if (readyWorkerIndexes.length > 0) {
    const preferredIndex = videoWorkerAffinity.get(video);
    if (preferredIndex !== undefined && workerPool[preferredIndex]?.ready) {
      const preferredBusyCount = workerPool[preferredIndex]?.busyCount ?? 0;
      let leastBusyIndex = preferredIndex;
      let leastBusyCount = preferredBusyCount;

      for (const index of readyWorkerIndexes) {
        const busyCount = workerPool[index]?.busyCount ?? 0;
        if (busyCount < leastBusyCount) {
          leastBusyCount = busyCount;
          leastBusyIndex = index;
        }
      }

      if (preferredBusyCount <= leastBusyCount + 1) {
        return preferredIndex;
      }

      videoWorkerAffinity.set(video, leastBusyIndex);
      return leastBusyIndex;
    }

    let selectedIndex = readyWorkerIndexes[0];
    let selectedBusyCount = workerPool[selectedIndex]?.busyCount ?? 0;

    for (const index of readyWorkerIndexes) {
      const busyCount = workerPool[index]?.busyCount ?? 0;
      if (busyCount < selectedBusyCount) {
        selectedBusyCount = busyCount;
        selectedIndex = index;
      }
    }

    videoWorkerAffinity.set(video, selectedIndex);
    return selectedIndex;
  }

  const preferredIndex = videoWorkerAffinity.get(video);
  if (preferredIndex !== undefined) {
    const preferredBusyCount = workerPool[preferredIndex]?.busyCount ?? 0;
    let leastBusyIndex = preferredIndex;
    let leastBusyCount = preferredBusyCount;

    for (let index = 0; index < workerPoolSize; index += 1) {
      const busyCount = workerPool[index]?.busyCount ?? 0;
      if (busyCount < leastBusyCount) {
        leastBusyCount = busyCount;
        leastBusyIndex = index;
      }
    }

    if (preferredBusyCount <= leastBusyCount + 1) {
      return preferredIndex;
    }

    videoWorkerAffinity.set(video, leastBusyIndex);
    return leastBusyIndex;
  }

  let selectedIndex = 0;
  let selectedBusyCount = Number.POSITIVE_INFINITY;

  for (let index = 0; index < workerPoolSize; index += 1) {
    const worker = workerPool[index];
    const busyCount = worker?.busyCount ?? 0;
    if (busyCount < selectedBusyCount) {
      selectedBusyCount = busyCount;
      selectedIndex = index;
    }
  }

  videoWorkerAffinity.set(video, selectedIndex);
  return selectedIndex;
}

function runDetector(video: string, timestamp: number, cacheKey: string): Promise<DetectionResult> {
  const cached = lastSuccessfulDetections.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const existingRequest = inFlightDetections.get(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = new Promise<DetectionResult>(async (resolve, reject) => {
    const workerIndex = getWorkerIndexForVideo(video);

    try {
      await ensureWorker(workerIndex);
      await enqueueWorkerTask(workerIndex, async () => {
        const worker = workerPool[workerIndex];
        if (!worker?.process.stdin.writable) {
          throw new Error(`Detector worker ${workerIndex} is not writable.`);
        }

        worker.busyCount += 1;
        workerSequence += 1;
        const requestId = `req-${workerSequence}`;

        const timeoutId = setTimeout(() => {
          pendingRequests.delete(requestId);
          worker.busyCount = Math.max(0, worker.busyCount - 1);

          const fallback = staleResult(cacheKey);
          if (fallback) {
            resolve(fallback);
            return;
          }

          const liveCacheKey = parseLiveCacheKey(cacheKey);
          if (liveCacheKey) {
            const videoFallback = staleVideoResult(liveCacheKey.video, liveCacheKey.timestamp);
            if (videoFallback) {
              resolve(videoFallback);
              return;
            }

            resolve({
              detections: [],
              hasAmbulance: false,
              note: LIVE_EMPTY_FALLBACK_NOTE,
              stale: true,
            });
            return;
          }

          reject(new Error('Detector timed out while processing the frame.'));
        }, DETECTION_WORKER_TIMEOUT_MS);

        pendingRequests.set(requestId, {
          resolve,
          reject,
          timeoutId,
          cacheKey,
          workerIndex,
        });

        worker.process.stdin.write(
          JSON.stringify({
            id: requestId,
            video: path.join('public', 'videos', video),
            time: Number(timestamp.toFixed(2)),
          }) + '\n'
        );
      });
    } catch (error) {
      const fallback = staleResult(cacheKey);
      if (fallback) {
        resolve(fallback);
        return;
      }

      reject(error);
    }
  }).finally(() => {
    inFlightDetections.delete(cacheKey);
  });

  inFlightDetections.set(cacheKey, request);
  return request;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, workers: workerPoolSize, detectorReady: warmedWorkers > 0, warmedWorkers });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, workers: workerPoolSize, benchmark: true, detectorReady: warmedWorkers > 0, warmedWorkers });
});

app.get('/api/detections', async (req, res) => {
  const video = String(req.query.video ?? '');
  const timestamp = Number(req.query.time ?? 0);
  const quantizedTimestamp = Math.floor(timestamp * CACHE_BUCKETS_PER_SECOND) / CACHE_BUCKETS_PER_SECOND;
  const cacheKey = `${video}:${quantizedTimestamp}`;

  if (!allowedVideoPattern.test(video)) {
    res.status(400).json({ error: 'Unsupported video file.' });
    return;
  }

  if (!Number.isFinite(timestamp) || timestamp < 0) {
    res.status(400).json({ error: 'Invalid timestamp.' });
    return;
  }

  try {
    const fallback = staleVideoResult(video, quantizedTimestamp);
    if (fallback) {
      void runDetector(video, quantizedTimestamp, cacheKey).catch(() => {
        // Keep serving the last stable result while the next frame catches up.
      });
      prefetchVideoFrame(video, quantizedTimestamp + 1 / CACHE_BUCKETS_PER_SECOND);
      res.json(fallback);
      return;
    }

    if (hasVideoRequestInFlight(video)) {
      const busyFallback = staleVideoResult(video, quantizedTimestamp);
      if (busyFallback) {
        void runDetector(video, quantizedTimestamp, cacheKey).catch(() => {
          // Keep the refresh loop running in the background.
        });
        prefetchVideoFrame(video, quantizedTimestamp + 1 / CACHE_BUCKETS_PER_SECOND);
        res.json(busyFallback);
        return;
      }

      res.json({
        detections: [],
        hasAmbulance: false,
        note: LIVE_EMPTY_FALLBACK_NOTE,
        stale: true,
      });
      return;
    }

    const result = await runDetector(video, quantizedTimestamp, cacheKey);
    prefetchVideoFrame(video, quantizedTimestamp + 1 / CACHE_BUCKETS_PER_SECOND);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Detection failed.',
      details: error instanceof Error ? error.message : 'Unknown detection error',
    });
  }
});

app.get('/tasks', (_req, res) => {
  res.json({
    tasks: listBenchmarkTasks(),
  });
});

app.post('/reset', async (req, res) => {
  try {
    const taskId = typeof req.body?.task_id === 'string' ? req.body.task_id : undefined;
    const state = await resetBenchmark(runDetector, taskId);
    res.json(state);
  } catch (error) {
    res.status(500).json({
      error: 'Reset failed.',
      details: error instanceof Error ? error.message : 'Unknown reset error',
    });
  }
});

app.get('/state', (_req, res) => {
  const state = getBenchmarkState();
  if (!state) {
    res.status(404).json({
      error: 'No active benchmark session.',
      details: 'Call POST /reset before requesting the benchmark state.',
    });
    return;
  }

  res.json(state);
});

app.post('/step', (req, res) => {
  const selectedLaneId = Number(req.body?.selected_lane_id ?? req.body?.action ?? req.body?.lane_id);
  if (!Number.isInteger(selectedLaneId) || selectedLaneId < 0) {
    res.status(400).json({
      error: 'Invalid action.',
      details: 'Provide an integer selected_lane_id in the request body.',
    });
    return;
  }

  try {
    const result = stepBenchmark(selectedLaneId);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Step failed.',
      details: error instanceof Error ? error.message : 'Unknown step error',
    });
  }
});

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/tasks' || req.path === '/state' || req.path === '/reset' || req.path === '/step') {
      next();
      return;
    }

    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      message: 'SmartFlow AI server is running. Build the frontend to serve the dashboard from this process.',
    });
  });
}

const port = Number(process.env.PORT ?? 3001);

async function startServer() {
  try {
    await ensureWorkerPool();
    console.log(`Detector worker pool warmed up with ${workerPoolSize} workers.`);
    if (PRIME_CACHE_ON_STARTUP) {
      await primeDetectionCache();
      console.log('Detector cache primed for all deployment videos.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Detector worker pool failed to start.');
  }

  app.listen(port, () => {
    console.log(`Detection API listening on http://localhost:${port}`);
  });
}

void startServer();
