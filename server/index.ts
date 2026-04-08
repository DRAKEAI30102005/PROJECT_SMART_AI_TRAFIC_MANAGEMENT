import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const app = express();
const distDir = path.join(rootDir, 'dist');
const allowedVideoPattern = /^video[1-8]\.mp4$/i;
const lastSuccessfulDetections = new Map<string, DetectionResult>();
const inFlightDetections = new Map<string, Promise<DetectionResult>>();
const pendingRequests = new Map<string, PendingRequest>();
const workerPool: Array<WorkerEntry | null> = [];
const workerPoolSize = 4;

let workerSequence = 0;

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
  const workerProcess = spawn('python', ['-u', 'ml/scripts/detect_worker.py'], { cwd: rootDir });

  const readyPromise = new Promise<void>((resolve, reject) => {
    let resolved = false;
    const startupLogs: string[] = [];

    const readyTimer = setTimeout(() => {
      if (!resolved) {
        reject(new Error(startupLogs.join(' ') || `Detector worker ${workerIndex} timed out while starting.`));
      }
    }, 45000);

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
            resolved = true;
            clearTimeout(readyTimer);
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
  };
}

function ensureWorker(workerIndex: number): Promise<void> {
  let worker = workerPool[workerIndex];
  if (!worker) {
    worker = startWorker(workerIndex);
    workerPool[workerIndex] = worker;
  }
  return worker.readyPromise;
}

async function ensureWorkerPool(): Promise<void> {
  await Promise.all(Array.from({ length: workerPoolSize }, (_, index) => ensureWorker(index)));
}

function getWorkerIndexForVideo(video: string): number {
  const match = video.match(/video(\d+)\.mp4/i);
  if (match) {
    const videoNumber = Number(match[1]);
    if (Number.isFinite(videoNumber) && videoNumber > 0) {
      return (videoNumber - 1) % workerPoolSize;
    }
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

  return selectedIndex;
}

function runDetector(video: string, timestamp: number, cacheKey: string): Promise<DetectionResult> {
  const existingRequest = inFlightDetections.get(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = new Promise<DetectionResult>(async (resolve, reject) => {
    const workerIndex = getWorkerIndexForVideo(video);

    try {
      await ensureWorker(workerIndex);

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

        reject(new Error('Detector timed out while processing the frame.'));
      }, 12000);

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
  res.json({ ok: true, workers: workerPoolSize });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, workers: workerPoolSize, benchmark: true });
});

app.get('/api/detections', async (req, res) => {
  const video = String(req.query.video ?? '');
  const timestamp = Number(req.query.time ?? 0);
  const cacheKey = `${video}:${Math.floor(timestamp * 8) / 8}`;

  if (!allowedVideoPattern.test(video)) {
    res.status(400).json({ error: 'Unsupported video file.' });
    return;
  }

  if (!Number.isFinite(timestamp) || timestamp < 0) {
    res.status(400).json({ error: 'Invalid timestamp.' });
    return;
  }

  try {
    const result = await runDetector(video, timestamp, cacheKey);
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

app.listen(port, async () => {
  console.log(`Detection API listening on http://localhost:${port}`);
  try {
    await ensureWorkerPool();
    console.log(`Detector worker pool warmed up with ${workerPoolSize} workers.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Detector worker pool failed to start.');
  }
});
