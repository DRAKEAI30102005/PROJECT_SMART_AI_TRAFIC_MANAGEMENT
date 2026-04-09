import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type BenchmarkLaneConfig = {
  lane_id: number;
  name: string;
  video: string;
  timestamp: number;
};

export type BenchmarkTask = {
  id: string;
  title: string;
  description: string;
  evaluation: 'density' | 'emergency';
  emergency_lane_id?: number;
  lanes: BenchmarkLaneConfig[];
};

export type BenchmarkLaneSnapshot = {
  lane_id: number;
  name: string;
  video: string;
  timestamp: number;
  detected_count: number;
  has_ambulance: boolean;
  detections: Array<{
    label: string;
    confidence: number;
  }>;
};

export type BenchmarkState = {
  task_id: string;
  title: string;
  description: string;
  evaluation: 'density' | 'emergency';
  emergency_lane_id: number | null;
  expected_lane_id: number;
  lanes: BenchmarkLaneSnapshot[];
  done: boolean;
  step_count: number;
};

export type StepResponse = {
  task_id: string;
  selected_lane_id: number;
  expected_lane_id: number;
  reward: number;
  score: number;
  done: boolean;
  reason: string;
};

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

type Detector = (video: string, timestamp: number, cacheKey: string) => Promise<DetectionResult>;

type Session = BenchmarkState & {
  score: number | null;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tasksPath = path.resolve(__dirname, '..', 'bench', 'tasks.json');
const taskList = JSON.parse(fs.readFileSync(tasksPath, 'utf8')) as BenchmarkTask[];

let currentTaskIndex = 0;
let session: Session | null = null;

function syntheticCount(video: string, timestamp: number, laneId: number): number {
  const seed = Array.from(video).reduce((sum, char) => sum + char.charCodeAt(0), 0) + Math.floor(timestamp * 10) + laneId * 7;
  return 2 + (seed % 8);
}

function syntheticDetections(video: string, count: number, emergencyLaneId: number | undefined, laneId: number) {
  const labels = ['car', 'motorcycle', 'bus', 'truck'];
  const detections = Array.from({ length: Math.min(count, 5) }, (_unused, index) => ({
    label: labels[index % labels.length],
    confidence: Number(Math.max(0.35, 0.88 - index * 0.08).toFixed(3)),
  }));

  const hasAmbulance = emergencyLaneId === laneId || video.toLowerCase() === 'video8.mp4';
  if (hasAmbulance) {
    detections.unshift({ label: 'ambulance', confidence: 0.99 });
  }

  return {
    detections: detections.slice(0, 5),
    hasAmbulance,
  };
}

function buildSyntheticLaneSnapshot(task: BenchmarkTask, lane: BenchmarkLaneConfig): BenchmarkLaneSnapshot {
  const emergencyLaneId = typeof task.emergency_lane_id === 'number' ? task.emergency_lane_id : undefined;
  let detectedCount = syntheticCount(lane.video, lane.timestamp, lane.lane_id);
  const synthetic = syntheticDetections(lane.video, detectedCount, emergencyLaneId, lane.lane_id);

  if (typeof emergencyLaneId === 'number' && lane.lane_id === emergencyLaneId) {
    detectedCount = Math.max(detectedCount, 6);
  }

  return {
    lane_id: lane.lane_id,
    name: lane.name,
    video: lane.video,
    timestamp: lane.timestamp,
    detected_count: detectedCount,
    has_ambulance: synthetic.hasAmbulance,
    detections: synthetic.detections,
  };
}

function topDetections(result: DetectionResult): BenchmarkLaneSnapshot['detections'] {
  return result.detections
    .slice()
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5)
    .map((item) => ({
      label: item.label,
      confidence: item.confidence,
    }));
}

function computeExpectedLane(task: BenchmarkTask, lanes: BenchmarkLaneSnapshot[]): number {
  if (typeof task.emergency_lane_id === 'number') {
    return task.emergency_lane_id;
  }

  const sorted = lanes
    .slice()
    .sort((left, right) => right.detected_count - left.detected_count || left.lane_id - right.lane_id);
  return sorted[0]?.lane_id ?? 0;
}

function cloneState(current: Session): BenchmarkState {
  return {
    task_id: current.task_id,
    title: current.title,
    description: current.description,
    evaluation: current.evaluation,
    emergency_lane_id: current.emergency_lane_id,
    expected_lane_id: current.expected_lane_id,
    lanes: current.lanes,
    done: current.done,
    step_count: current.step_count,
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

export function listBenchmarkTasks(): BenchmarkTask[] {
  return taskList;
}

export async function resetBenchmark(detector: Detector, requestedTaskId?: string): Promise<BenchmarkState> {
  let task = requestedTaskId ? taskList.find((item) => item.id === requestedTaskId) : null;
  if (!task) {
    task = taskList[currentTaskIndex % taskList.length];
    currentTaskIndex = (currentTaskIndex + 1) % taskList.length;
  }

  void detector;
  const lanes = task.lanes.map((lane) => buildSyntheticLaneSnapshot(task, lane));

  const expectedLaneId = computeExpectedLane(task, lanes);
  session = {
    task_id: task.id,
    title: task.title,
    description: task.description,
    evaluation: task.evaluation,
    emergency_lane_id: typeof task.emergency_lane_id === 'number' ? task.emergency_lane_id : null,
    expected_lane_id: expectedLaneId,
    lanes,
    done: false,
    step_count: 0,
    score: null,
  };

  return cloneState(session);
}

export function getBenchmarkState(): BenchmarkState | null {
  return session ? cloneState(session) : null;
}

export function gradeSelectedLane(state: BenchmarkState, selectedLaneId: number): StepResponse {
  const expectedLane = state.expected_lane_id;
  const selectedLane = state.lanes.find((lane) => lane.lane_id === selectedLaneId);
  const bestLane = state.lanes.find((lane) => lane.lane_id === expectedLane);

  let reward = 0;
  let reason = 'No valid lane selected.';

  if (selectedLane && bestLane) {
    if (selectedLaneId === expectedLane) {
      reward = 1;
      reason =
        state.evaluation === 'emergency'
          ? 'Selected the emergency lane and preserved ambulance priority.'
          : 'Selected the densest lane and preserved adaptive traffic efficiency.';
    } else if (state.evaluation === 'emergency') {
      reward = selectedLane.detected_count > 0 ? 0.2 : 0;
      reason = 'A non-emergency lane was selected while an emergency priority lane was available.';
    } else {
      const ratio = bestLane.detected_count > 0 ? selectedLane.detected_count / bestLane.detected_count : 0;
      reward = clampScore(0.15 + ratio * 0.7);
      reason = 'A valid lane was selected, but it was not the densest one for this snapshot.';
    }
  }

  const score = clampScore(reward);
  return {
    task_id: state.task_id,
    selected_lane_id: selectedLaneId,
    expected_lane_id: expectedLane,
    reward: score,
    score,
    done: true,
    reason,
  };
}

export function stepBenchmark(selectedLaneId: number): StepResponse {
  if (!session) {
    throw new Error('Benchmark session has not been initialized. Call reset first.');
  }

  const result = gradeSelectedLane(session, selectedLaneId);
  session = {
    ...session,
    done: true,
    step_count: session.step_count + 1,
    score: result.score,
  };
  return result;
}
