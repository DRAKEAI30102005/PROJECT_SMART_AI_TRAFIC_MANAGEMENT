import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTrafficSimulation } from '../hooks/useTrafficSimulation';
import { LaneCard, type LaneLiveSnapshot } from './LaneCard';
import { AnalysisDashboard } from './AnalysisDashboard';
import { CameraFeed } from '../lib/cameraFeeds';
import { type SharedDetectionFrame, fetchDetectionFrame } from '../lib/detectionApi';
import { Activity, AlertTriangle, Car, Clock, TrendingDown, Siren, LogOut, BarChart3, Video, Home } from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
  onChangeFootage: () => void;
  onGoHome: () => void;
  selectedCameras: CameraFeed[];
  initialSharedDetections?: Record<number, SharedDetectionFrame>;
}

type HistoryPoint = {
  time: string;
  totalDetections: number;
  activeAmbulances: number;
};

export function Dashboard({ onLogout, onChangeFootage, onGoHome, selectedCameras, initialSharedDetections = {} }: DashboardProps) {
  const { lanes, stats, ambulanceAlert, triggerAmbulance, isAmbulanceOverride, updateVideoAmbulanceDetection } = useTrafficSimulation();
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [liveLaneSnapshots, setLiveLaneSnapshots] = useState<Record<number, LaneLiveSnapshot>>({});
  const [analysisLaneSnapshots, setAnalysisLaneSnapshots] = useState<Record<number, LaneLiveSnapshot>>({});
  const [sharedDetections, setSharedDetections] = useState<Record<number, SharedDetectionFrame>>(initialSharedDetections);
  const [historicalDensity, setHistoricalDensity] = useState<HistoryPoint[]>([]);
  const liveLaneSnapshotsRef = React.useRef(liveLaneSnapshots);
  const videoElementsRef = React.useRef<Record<number, HTMLVideoElement | null>>({});
  const laneRequestInFlightRef = React.useRef<Record<number, boolean>>({});
  const laneLastRequestedTimeRef = React.useRef<Record<number, number>>({});
  const laneLastRequestedAtRef = React.useRef<Record<number, number>>({});
  const nextSharedLaneIndexRef = React.useRef(0);
  const laneCameraMap = useMemo(
    () =>
      Object.fromEntries(
        lanes
          .map((lane, index) => [lane.id, selectedCameras[index]] as const)
          .filter((entry): entry is readonly [number, CameraFeed] => Boolean(entry[1]))
      ),
    [lanes, selectedCameras]
  );

  const requestLaneDetection = useCallback(
    (laneId: number, camera: CameraFeed, explicitTimeInSeconds?: number) => {
      if (laneRequestInFlightRef.current[laneId]) {
        return;
      }

      const videoElement = videoElementsRef.current[laneId];
      const fallbackStartupTime = camera.videoFile === 'video8.mp4' ? 0.6 : 0.35;
      const timeInSeconds = explicitTimeInSeconds ?? videoElement?.currentTime ?? fallbackStartupTime;
      const lastRequestedTime = laneLastRequestedTimeRef.current[laneId];
      const lastRequestedAt = laneLastRequestedAtRef.current[laneId] ?? 0;
      const now = Date.now();
      const frameMovedEnough =
        lastRequestedTime === undefined || Math.abs(timeInSeconds - lastRequestedTime) >= 0.3;
      const requestCooldownElapsed = now - lastRequestedAt >= 320;

      if (!frameMovedEnough && !requestCooldownElapsed) {
        return;
      }

      laneRequestInFlightRef.current[laneId] = true;
      laneLastRequestedTimeRef.current[laneId] = timeInSeconds;
      laneLastRequestedAtRef.current[laneId] = now;

      void fetchDetectionFrame(camera.videoFile, timeInSeconds)
        .then((payload) => {
          setSharedDetections((previous) => ({
            ...previous,
            [laneId]: {
              timeInSeconds,
              payload,
              updatedAt: Date.now(),
            },
          }));
        })
        .catch(() => {
          // Leave the existing shared detection in place if bootstrap is still warming up.
        })
        .finally(() => {
          laneRequestInFlightRef.current[laneId] = false;
        });
    },
    []
  );

  const registerVideoElement = useCallback(
    (laneId: number, element: HTMLVideoElement | null) => {
      videoElementsRef.current[laneId] = element;
    },
    []
  );

  useEffect(() => {
    liveLaneSnapshotsRef.current = liveLaneSnapshots;
  }, [liveLaneSnapshots]);

  useEffect(() => {
    if (!showAnalysis) {
      return;
    }

    setAnalysisLaneSnapshots(liveLaneSnapshotsRef.current);
    const interval = window.setInterval(() => {
      setAnalysisLaneSnapshots(liveLaneSnapshotsRef.current);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [showAnalysis]);

  useEffect(() => {
    if (Object.keys(initialSharedDetections).length === 0) {
      return;
    }

    setSharedDetections((previous) => ({
      ...initialSharedDetections,
      ...previous,
    }));
  }, [initialSharedDetections]);

  useEffect(() => {
    let cancelled = false;

    const runSharedDetectionPulse = () => {
      if (cancelled) {
        return;
      }

      const activeLanes = lanes
        .map((lane, index) => ({
          lane,
          camera: selectedCameras[index],
          videoElement: videoElementsRef.current[lane.id],
        }))
        .filter((item): item is { lane: typeof lanes[number]; camera: CameraFeed; videoElement: HTMLVideoElement } =>
          Boolean(item.camera && item.videoElement)
        );

      if (activeLanes.length === 0) {
        return;
      }

      const selectedLane = activeLanes[nextSharedLaneIndexRef.current % activeLanes.length];
      nextSharedLaneIndexRef.current = (nextSharedLaneIndexRef.current + 1) % activeLanes.length;
      requestLaneDetection(selectedLane.lane.id, selectedLane.camera, selectedLane.videoElement.currentTime ?? 0);
    };

    runSharedDetectionPulse();
    const interval = window.setInterval(runSharedDetectionPulse, 320);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [lanes, requestLaneDetection, selectedCameras]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setHistoricalDensity((previous) => {
        const snapshots = Object.values(liveLaneSnapshotsRef.current) as LaneLiveSnapshot[];
        const totalDetections = snapshots.reduce((sum, snapshot) => sum + snapshot.detectedCount, 0);
        const activeAmbulances = snapshots.filter((snapshot) => snapshot.hasAmbulance).length;

        const nextPoint: HistoryPoint = {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          totalDetections,
          activeAmbulances,
        };

        return [...previous.slice(-11), nextPoint];
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, []);

  const updateLaneSnapshot = useCallback((snapshot: LaneLiveSnapshot) => {
    setLiveLaneSnapshots((previous) => {
      const existing = previous[snapshot.laneId];
      const sameSnapshot =
        existing &&
        existing.detectedCount === snapshot.detectedCount &&
        existing.hasAmbulance === snapshot.hasAmbulance &&
        existing.detections.length === snapshot.detections.length &&
        existing.detections.every(
          (detection, index) =>
            detection.label === snapshot.detections[index]?.label &&
            detection.confidence === snapshot.detections[index]?.confidence
        );

      if (sameSnapshot) {
        return previous;
      }

      return {
        ...previous,
        [snapshot.laneId]: snapshot,
      };
    });
  }, []);

  const liveFeedGrid = useMemo(
    () => (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-6xl mx-auto bg-gray-100 p-4 rounded-xl border border-gray-300">
        {lanes.map((lane, index) =>
          selectedCameras[index] ? (
            <LaneCard
              key={lane.id}
              lane={lane}
              cameraName={selectedCameras[index].name}
              videoFile={selectedCameras[index].videoFile}
              onAmbulanceDetectionChange={(detected) => updateVideoAmbulanceDetection(lane.id, detected)}
              onLiveDataChange={updateLaneSnapshot}
              onTriggerAmbulance={() => triggerAmbulance(lane.id)}
              sharedDetection={sharedDetections[lane.id] ?? null}
              sharedDetectionEnabled
              registerVideoElement={registerVideoElement}
            />
          ) : null
        )}
      </div>
    ),
    [lanes, registerVideoElement, selectedCameras, sharedDetections, triggerAmbulance, updateLaneSnapshot, updateVideoAmbulanceDetection]
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Activity className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">SmartFlow AI</h1>
              <p className="text-xs text-gray-500 font-medium">Intelligent Traffic Management System</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isAmbulanceOverride && (
              <div className="flex items-center gap-2 px-4 py-1.5 bg-red-100 text-red-700 rounded-full animate-pulse border border-red-200">
                <Siren size={16} />
                <span className="text-sm font-bold tracking-wide">EMERGENCY OVERRIDE</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-gray-600">System Online</span>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors ml-2"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      </header>

      {ambulanceAlert && (
        <div className="bg-red-600 text-white px-4 py-3 flex items-center justify-center gap-3 shadow-md animate-in slide-in-from-top-4">
          <AlertTriangle className="animate-bounce" />
          <p className="font-bold text-lg">{ambulanceAlert}</p>
        </div>
      )}

      <main className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 ${showAnalysis ? 'pointer-events-none select-none opacity-40' : ''}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={<Car className="text-blue-500" />} title="Total Vehicles Processed" value={stats.totalVehicles.toLocaleString()} trend="+12% vs last hour" />
          <StatCard icon={<Clock className="text-orange-500" />} title="Avg. Wait Time" value={`${stats.averageWaitTime.toFixed(1)}s`} trend="-65% vs traditional" trendGood />
          <StatCard icon={<AlertTriangle className="text-red-500" />} title="Ambulances Prioritized" value={stats.ambulancesDetected.toString()} trend="100% clearance rate" trendGood />
          <StatCard icon={<TrendingDown className="text-green-500" />} title="Congestion Reduced" value={`${stats.congestionReduced}%`} trend="Peak efficiency" trendGood />
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Live Traffic Dashboard</h2>
          {liveFeedGrid}
        </div>

        <div className="flex justify-center gap-4 mb-12 max-w-6xl mx-auto flex-wrap">
          <button
            onClick={() => setShowAnalysis(true)}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium shadow-md transition-all hover:scale-105"
          >
            <BarChart3 size={20} />
            View analysis
          </button>
          <button
            onClick={onChangeFootage}
            className="flex items-center gap-2 px-6 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium shadow-md transition-all hover:scale-105"
          >
            <Video size={20} />
            Change footage
          </button>
          <button
            onClick={onGoHome}
            className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-medium shadow-md transition-all hover:scale-105"
          >
            <Home size={20} />
            Home
          </button>
        </div>
      </main>

      {showAnalysis ? (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-gray-50/95 backdrop-blur-sm">
          <AnalysisDashboard
            stats={stats}
            lanes={lanes}
            selectedCameras={selectedCameras}
            liveLaneSnapshots={analysisLaneSnapshots}
            historicalDensity={historicalDensity}
            onBack={() => setShowAnalysis(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ icon, title, value, trend, trendGood }: any) {
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-gray-50 rounded-xl">{icon}</div>
      </div>
      <div>
        <h4 className="text-gray-500 text-sm font-medium mb-1">{title}</h4>
        <div className="text-3xl font-bold text-gray-900 mb-2">{value}</div>
        <div className={`text-sm font-medium ${trendGood ? 'text-green-600' : 'text-gray-500'}`}>{trend}</div>
      </div>
    </div>
  );
}
