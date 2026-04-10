export interface Detection {
  id: string;
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectionApiResponse {
  detections: Omit<Detection, 'id'>[];
  hasAmbulance: boolean;
  note: string;
  error?: string;
  details?: string;
  stale?: boolean;
}

export interface SharedDetectionFrame {
  timeInSeconds: number;
  payload: DetectionApiResponse;
  updatedAt: number;
}

interface DetectionHealthResponse {
  ok: boolean;
  detectorReady?: boolean;
  warmedWorkers?: number;
}

const DETECTION_REQUEST_TIMEOUT_MS = 15000;

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
let lastKnownApiRoot: string | null = null;

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
            const payload = (await apiHealthResponse.json()) as DetectionHealthResponse;
            if (payload.ok && payload.detectorReady) {
              lastKnownApiRoot = root;
              return root;
            }
          }

          const rootHealthResponse = await fetch(root ? `${root}/health` : '/health');
          if (rootHealthResponse.ok) {
            const payload = (await rootHealthResponse.json()) as DetectionHealthResponse;
            if (payload.ok && payload.detectorReady) {
              lastKnownApiRoot = root;
              return root;
            }
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
    throw new Error('Detection response was incomplete. Retrying automatically.');
  }
}

export async function fetchDetectionFrame(videoFile: string, timeInSeconds: number): Promise<DetectionApiResponse> {
  const apiRoot = await ensureDetectionApiReady();
  if (apiRoot === null) {
    if (lastKnownApiRoot) {
      healthCheckPromise = null;
    }
    throw new Error('Detector is still warming up. Please wait a moment.');
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, DETECTION_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${apiUrl(apiRoot, '/detections')}?video=${encodeURIComponent(videoFile)}&time=${timeInSeconds.toFixed(2)}`,
      { signal: controller.signal }
    );
  } catch (error) {
    window.clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Detection request timed out. Retrying automatically.');
    }
    throw error;
  }
  window.clearTimeout(timeoutId);

  try {
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
      if ((payload.details || payload.error || '').toLowerCase().includes('warm')) {
        healthCheckPromise = null;
        throw new Error('Detector is still warming up. Please wait a moment.');
      }
      throw new Error(payload.details || payload.error || 'Detection request failed.');
    }

    return payload;
  } catch (error) {
    throw error;
  }
}
