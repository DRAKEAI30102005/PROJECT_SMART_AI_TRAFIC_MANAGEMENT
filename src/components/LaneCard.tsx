import React, { useEffect, useRef, useState } from 'react';
import { LaneState } from '../hooks/useTrafficSimulation';
import { LoaderCircle } from 'lucide-react';

interface LaneCardProps {
  key?: React.Key;
  lane: LaneState;
  cameraName: string;
  videoFile: string;
  onAmbulanceDetectionChange: (detected: boolean) => void;
  onLiveDataChange?: (snapshot: LaneLiveSnapshot) => void;
  backgroundMode?: boolean;
  onTriggerAmbulance: () => void;
}

interface Detection {
  id: string;
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DetectionApiResponse {
  detections: Omit<Detection, 'id'>[];
  hasAmbulance: boolean;
  note: string;
  error?: string;
  details?: string;
  stale?: boolean;
}

export interface LaneLiveSnapshot {
  laneId: number;
  cameraName: string;
  videoFile: string;
  detectedCount: number;
  hasAmbulance: boolean;
  detections: Array<{
    label: string;
    confidence: number;
  }>;
  updatedAt: number;
}

interface TrackBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TrackedDetection extends Detection {
  trackId: string;
  current: TrackBox;
  target: TrackBox;
  velocity: TrackBox;
  missingFrames: number;
  lastSeenAtMs: number;
  lastAnimatedAtMs: number;
  lastDetectionTime: number;
}

const TRACK_IOU_THRESHOLD = 0.28;
const DUPLICATE_IOU_THRESHOLD = 0.62;
const TRACK_SMOOTHING = 0.68;
const MAX_MISSING_FRAMES = 10;
const MAX_STALE_TRACK_MS = 2200;
const EXIT_MARGIN_PERCENT = 3;
const DETECTION_POLL_MS = 110;
const DETECTION_FRAME_STEP_SECONDS = 0.2;
const API_ROOT_CANDIDATES =
  typeof window !== 'undefined'
    ? Array.from(
        new Set([
          window.location.origin,
          '',
          `${window.location.protocol}//${window.location.hostname}:3001`,
          'http://localhost:3001',
        ])
      )
    : ['http://localhost:3001', ''];

let healthCheckPromise: Promise<string | null> | null = null;

function apiUrl(root: string, endpoint: string): string {
  if (!root) {
    return `/api${endpoint}`;
  }

  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return `${normalizedRoot}/api${endpoint}`;
}

async function ensureDetectionApiReady(): Promise<string | null> {
  if (!healthCheckPromise) {
    healthCheckPromise = (async () => {
      for (const root of API_ROOT_CANDIDATES) {
        try {
          const apiHealthResponse = await fetch(apiUrl(root, '/health'));
          if (apiHealthResponse.ok) {
            return root;
          }

          const rootHealthResponse = await fetch(root ? `${root}/health` : '/health');
          if (rootHealthResponse.ok) {
            return root;
          }
        } catch {
          // Try the next candidate.
        }

        try {
          const fallbackResponse = await fetch(root ? `${root}/health` : '/health');
          if (fallbackResponse.ok) {
            return root;
          }
        } catch {
          // Try the next candidate.
        }
      }
      return null;
    })().finally(() => {
      window.setTimeout(() => {
        healthCheckPromise = null;
      }, 1500);
    });
  }

  return healthCheckPromise;
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function parseDetectionPayload(text: string): DetectionApiResponse {
  try {
    const jsonPayload = extractJsonObject(text);
    if (!jsonPayload) {
      throw new Error('Empty detector response');
    }
    return JSON.parse(jsonPayload) as DetectionApiResponse;
  } catch {
    throw new Error('Detection service is warming up. Retrying automatically.');
  }
}

function computeIoU(a: TrackBox, b: TrackBox): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;

  const intersectionWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const intersectionHeight = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const intersection = intersectionWidth * intersectionHeight;

  if (intersection <= 0) {
    return 0;
  }

  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

function createTrackBox(detection: Detection): TrackBox {
  return { x: detection.x, y: detection.y, w: detection.w, h: detection.h };
}

function isConflictingVehicleClass(labelA: string, labelB: string): boolean {
  return ['car', 'truck', 'bus', 'ambulance'].includes(labelA) && ['car', 'truck', 'bus', 'ambulance'].includes(labelB);
}

function canReuseTrack(trackLabel: string, detectionLabel: string): boolean {
  return trackLabel === detectionLabel || isConflictingVehicleClass(trackLabel, detectionLabel);
}

function dedupeDetections(detections: Detection[]): Detection[] {
  const sorted = [...detections].sort((left, right) => right.confidence - left.confidence);
  const filtered: Detection[] = [];

  for (const detection of sorted) {
    const box = createTrackBox(detection);
    const duplicate = filtered.some((candidate) => {
      const sameLabel = candidate.label === detection.label;
      const conflictingVehicle = isConflictingVehicleClass(candidate.label, detection.label);
      return (sameLabel || conflictingVehicle) && computeIoU(createTrackBox(candidate), box) >= DUPLICATE_IOU_THRESHOLD;
    });

    if (!duplicate) {
      filtered.push(detection);
    }
  }

  return filtered;
}

function mergeDetectionsIntoTracks(
  previousTracks: TrackedDetection[],
  detections: Detection[],
  trackCounterRef: React.MutableRefObject<number>,
  detectionTime: number,
  nowMs: number
): TrackedDetection[] {
  const dedupedDetections = dedupeDetections(detections);
  const nextTracks: TrackedDetection[] = [];
  const usedTrackIds = new Set<string>();

  for (const detection of dedupedDetections) {
    const detectionBox = createTrackBox(detection);
    let bestTrack: TrackedDetection | null = null;
    let bestScore = 0;

    for (const track of previousTracks) {
      if (usedTrackIds.has(track.trackId) || !canReuseTrack(track.label, detection.label)) {
        continue;
      }

      const secondsSinceLastDetection = Math.max(detectionTime - track.lastDetectionTime, 0);
      const predictedBox = {
        x: track.target.x + track.velocity.x * secondsSinceLastDetection,
        y: track.target.y + track.velocity.y * secondsSinceLastDetection,
        w: track.target.w + track.velocity.w * secondsSinceLastDetection,
        h: track.target.h + track.velocity.h * secondsSinceLastDetection,
      };
      const iou = computeIoU(predictedBox, detectionBox);
      if (iou > bestScore) {
        bestScore = iou;
        bestTrack = track;
      }
    }

    if (bestTrack && bestScore >= TRACK_IOU_THRESHOLD) {
      usedTrackIds.add(bestTrack.trackId);
      const deltaSeconds = Math.max(detectionTime - bestTrack.lastDetectionTime, 0.08);
      nextTracks.push({
        ...detection,
        label: bestTrack.label === detection.label ? detection.label : bestTrack.label,
        confidence: Math.max(bestTrack.confidence * 0.9, detection.confidence),
        trackId: bestTrack.trackId,
        current: bestTrack.current,
        target: detectionBox,
        velocity: {
          x: (detectionBox.x - bestTrack.target.x) / deltaSeconds,
          y: (detectionBox.y - bestTrack.target.y) / deltaSeconds,
          w: (detectionBox.w - bestTrack.target.w) / deltaSeconds,
          h: (detectionBox.h - bestTrack.target.h) / deltaSeconds,
        },
        missingFrames: 0,
        lastSeenAtMs: nowMs,
        lastAnimatedAtMs: nowMs,
        lastDetectionTime: detectionTime,
      });
      continue;
    }

    trackCounterRef.current += 1;
    nextTracks.push({
      ...detection,
      trackId: `track-${trackCounterRef.current}`,
      current: detectionBox,
      target: detectionBox,
      velocity: { x: 0, y: 0, w: 0, h: 0 },
      missingFrames: 0,
      lastSeenAtMs: nowMs,
      lastAnimatedAtMs: nowMs,
      lastDetectionTime: detectionTime,
    });
  }

  for (const track of previousTracks) {
    if (usedTrackIds.has(track.trackId)) {
      continue;
    }

    if (track.missingFrames + 1 <= MAX_MISSING_FRAMES && nowMs - track.lastSeenAtMs <= MAX_STALE_TRACK_MS) {
      const projectedTarget = {
        x: track.target.x + track.velocity.x * 0.12,
        y: track.target.y + track.velocity.y * 0.12,
        w: track.target.w + track.velocity.w * 0.12,
        h: track.target.h + track.velocity.h * 0.12,
      };
      const stillVisible =
        projectedTarget.x + projectedTarget.w > -EXIT_MARGIN_PERCENT &&
        projectedTarget.y + projectedTarget.h > -EXIT_MARGIN_PERCENT &&
        projectedTarget.x < 100 + EXIT_MARGIN_PERCENT &&
        projectedTarget.y < 100 + EXIT_MARGIN_PERCENT &&
        projectedTarget.w > 1 &&
        projectedTarget.h > 1;

      if (stillVisible) {
        nextTracks.push({
          ...track,
          target: projectedTarget,
          missingFrames: track.missingFrames + 1,
          lastAnimatedAtMs: nowMs,
        });
      }
    }
  }

  return nextTracks;
}

function animateTracks(previousTracks: TrackedDetection[]): TrackedDetection[] {
  const nowMs = performance.now();
  return previousTracks
    .map((track) => {
      const deltaSeconds = Math.max((nowMs - track.lastAnimatedAtMs) / 1000, 0);
      const projectedTarget = {
        x: track.target.x + track.velocity.x * deltaSeconds,
        y: track.target.y + track.velocity.y * deltaSeconds,
        w: track.target.w + track.velocity.w * deltaSeconds,
        h: track.target.h + track.velocity.h * deltaSeconds,
      };
      const current = {
        x: track.current.x + (projectedTarget.x - track.current.x) * TRACK_SMOOTHING,
        y: track.current.y + (projectedTarget.y - track.current.y) * TRACK_SMOOTHING,
        w: track.current.w + (projectedTarget.w - track.current.w) * TRACK_SMOOTHING,
        h: track.current.h + (projectedTarget.h - track.current.h) * TRACK_SMOOTHING,
      };
      const stillVisible =
        current.x + current.w > -EXIT_MARGIN_PERCENT &&
        current.y + current.h > -EXIT_MARGIN_PERCENT &&
        current.x < 100 + EXIT_MARGIN_PERCENT &&
        current.y < 100 + EXIT_MARGIN_PERCENT &&
        current.w > 1 &&
        current.h > 1 &&
        nowMs - track.lastSeenAtMs <= MAX_STALE_TRACK_MS;

      return stillVisible ? {
        ...track,
        current,
        target: projectedTarget,
        lastAnimatedAtMs: nowMs,
      } : null;
    })
    .filter((track): track is TrackedDetection => track !== null && track.missingFrames <= MAX_MISSING_FRAMES);
}

export function LaneCard({
  lane,
  cameraName,
  videoFile,
  onAmbulanceDetectionChange,
  onLiveDataChange,
  backgroundMode = false,
  onTriggerAmbulance,
}: LaneCardProps) {
  const videoUrl = `/videos/${videoFile}`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestInFlightRef = useRef(false);
  const pollingTimeoutRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFetchedTimeRef = useRef<number | null>(null);
  const trackCounterRef = useRef(0);
  const lastSnapshotSignatureRef = useRef('');
  const lastSnapshotEmitAtRef = useRef(0);

  const [trackedDetections, setTrackedDetections] = useState<TrackedDetection[]>([]);
  const [hasAmbulanceInFrame, setHasAmbulanceInFrame] = useState(false);
  const [modelNote, setModelNote] = useState('Loading detector...');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    void video.play().catch(() => {
      // Ignore autoplay/play interruption issues from the browser.
    });
  }, []);

  useEffect(() => {
    onAmbulanceDetectionChange(hasAmbulanceInFrame);
  }, [hasAmbulanceInFrame, onAmbulanceDetectionChange]);

  useEffect(() => {
    if (!onLiveDataChange) {
      return;
    }

    const visibleTracks = trackedDetections.filter((track) => track.missingFrames === 0);
    const detections = visibleTracks.map((track) => ({
      label: track.label,
      confidence: track.confidence,
    }));
    const signature = JSON.stringify({
      detectedCount: visibleTracks.length,
      hasAmbulance: hasAmbulanceInFrame,
      detections,
    });
    const now = Date.now();
    const shouldEmit =
      signature !== lastSnapshotSignatureRef.current ||
      now - lastSnapshotEmitAtRef.current >= (backgroundMode ? 750 : 500);

    if (!shouldEmit) {
      return;
    }

    lastSnapshotSignatureRef.current = signature;
    lastSnapshotEmitAtRef.current = now;

    onLiveDataChange({
      laneId: lane.id,
      cameraName,
      videoFile,
      detectedCount: visibleTracks.length,
      hasAmbulance: hasAmbulanceInFrame,
      detections,
      updatedAt: now,
    });
  }, [backgroundMode, cameraName, hasAmbulanceInFrame, lane.id, onLiveDataChange, trackedDetections, videoFile]);

  useEffect(() => {
    if (backgroundMode) {
      return;
    }

    let cancelled = false;

    const tick = () => {
      if (cancelled) {
        return;
      }

      setTrackedDetections((previousTracks) => animateTracks(previousTracks));
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [backgroundMode]);

  useEffect(() => {
    let cancelled = false;

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) {
        return;
      }
      pollingTimeoutRef.current = window.setTimeout(runDetectionLoop, delayMs);
    };

    const fetchDetections = async (timeInSeconds: number) => {
      requestInFlightRef.current = true;

      try {
        const apiRoot = await ensureDetectionApiReady();
        if (apiRoot === null) {
          throw new Error('Detection API is not reachable yet on the deployed app.');
        }

        const response = await fetch(
          `${apiUrl(apiRoot, '/detections')}?video=${encodeURIComponent(videoFile)}&time=${timeInSeconds.toFixed(2)}`
        );
        const responseText = await response.text();
        const isJsonResponse = response.headers.get('content-type')?.includes('application/json') ?? false;
        const payload = isJsonResponse
          ? parseDetectionPayload(responseText)
          : {
              detections: [],
              hasAmbulance: false,
              note: 'Detector unavailable.',
              error: 'Detection request failed.',
              details: 'Detection service returned a non-JSON response. Retrying automatically.',
            };

        if (!response.ok) {
          throw new Error(payload.details || payload.error || 'Detection request failed.');
        }

        if (cancelled) {
          return;
        }

        const mappedDetections = payload.detections.map((item, index) => ({
          ...item,
          id: `${item.label}-${index}-${item.x}-${item.y}-${item.w}-${item.h}`,
        }));

        lastFetchedTimeRef.current = timeInSeconds;
        setTrackedDetections((previousTracks) =>
          mergeDetectionsIntoTracks(previousTracks, mappedDetections, trackCounterRef, timeInSeconds, performance.now())
        );

        setHasAmbulanceInFrame(payload.hasAmbulance);
        setModelNote(String(payload.note ?? 'YOLO detections loaded.'));
        setError(null);
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        setError(requestError instanceof Error ? requestError.message : 'Unknown detection error');
        setModelNote('Waiting for detector...');
      } finally {
        requestInFlightRef.current = false;
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    const runDetectionLoop = async () => {
      if (cancelled || requestInFlightRef.current) {
        scheduleNextPoll(DETECTION_POLL_MS);
        return;
      }

      const currentTime = videoRef.current?.currentTime ?? 0;
      const lastFetchedTime = lastFetchedTimeRef.current;
      const frameMovedEnough =
        lastFetchedTime === null || Math.abs(currentTime - lastFetchedTime) >= DETECTION_FRAME_STEP_SECONDS;

      if (frameMovedEnough) {
        await fetchDetections(currentTime);
      }

      scheduleNextPoll(DETECTION_POLL_MS);
    };

    runDetectionLoop();

    return () => {
      cancelled = true;
      if (pollingTimeoutRef.current !== null) {
        window.clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, [videoFile]);

  const visibleVehicleCount = trackedDetections.filter((track) => track.missingFrames === 0).length;
  void onTriggerAmbulance;

  if (backgroundMode) {
    return (
      <div className="pointer-events-none fixed -left-10 -top-10 h-px w-px overflow-hidden opacity-0">
        <video
          ref={videoRef}
          className="h-px w-px"
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
        />
      </div>
    );
  }

  return (
    <div className="flex h-[280px] gap-2 rounded border border-gray-400 bg-[#d1d5db] p-2 shadow-md">
      <div className="flex w-14 flex-shrink-0 flex-col items-center gap-3 rounded border border-gray-500 bg-[#8a8a8a] py-3 shadow-inner">
        <div className={`h-8 w-8 rounded-full border border-gray-600 ${lane.light === 'red' ? 'bg-[#ff0000] shadow-[0_0_15px_rgba(255,0,0,0.8)]' : 'bg-[#4a0000]'}`} />
        <div className={`h-8 w-8 rounded-full border border-gray-600 ${lane.light === 'yellow' ? 'bg-[#ffb300] shadow-[0_0_15px_rgba(255,179,0,0.8)]' : 'bg-[#4a3300]'}`} />
        <div className={`h-8 w-8 rounded-full border border-gray-600 ${lane.light === 'green' ? 'bg-[#00ff00] shadow-[0_0_15px_rgba(0,255,0,0.8)]' : 'bg-[#004a00]'}`} />
      </div>

      <div className="group relative flex-1 overflow-hidden border border-gray-500 bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
        />

        <div className="pointer-events-none absolute left-0 right-0 top-2 z-10 flex justify-center">
          <span className="text-sm font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">{cameraName}</span>
        </div>

        <div className="pointer-events-none absolute left-2 top-8 z-20 flex max-w-[82%] flex-col gap-2">
          {isLoading && (
            <div className="inline-flex items-center gap-2 rounded-md bg-black/65 px-2 py-1 text-xs text-cyan-200">
              <LoaderCircle size={14} className="animate-spin" />
              {'Tracking vehicles continuously...'}
            </div>
          )}
          {error && <div className="rounded-md bg-red-950/80 px-2 py-1 text-xs text-red-200">{error}</div>}
          {!isLoading && <div className="rounded-md bg-black/65 px-2 py-1 text-xs text-slate-200">{modelNote}</div>}
        </div>

        <div className="pointer-events-none absolute inset-0 z-10">
          {trackedDetections.map((detection) => (
            <div
              key={detection.trackId}
              className="absolute border-[1.5px] border-[#ff6b00] transition-[top,left,width,height] duration-75 ease-linear"
              style={{
                top: `${detection.current.y}%`,
                left: `${detection.current.x}%`,
                width: `${detection.current.w}%`,
                height: `${detection.current.h}%`,
                opacity: Math.max(0.22, 1 - detection.missingFrames * 0.32),
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.2)',
              }}
            >
              <span
                className="absolute -top-5 left-0 whitespace-nowrap text-[14px] font-medium tracking-wide text-white"
                style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 0px 2px 4px rgba(0,0,0,0.8)' }}
              >
                {detection.label[0].toUpperCase() + detection.label.slice(1)} {detection.confidence.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-2 bg-black/60 px-2 py-1 font-mono text-[13px] text-white">
          <span>Density: {visibleVehicleCount}</span>
          <span>|</span>
          <span className={hasAmbulanceInFrame ? 'font-bold text-red-400' : ''}>Ambulance: {hasAmbulanceInFrame ? 'Yes' : 'No'}</span>
          <span>|</span>
          <span>Time: {lane.greenTimeRemaining > 0 ? lane.greenTimeRemaining : '--'}</span>
        </div>
      </div>
    </div>
  );
}
