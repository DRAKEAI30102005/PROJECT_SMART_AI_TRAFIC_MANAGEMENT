import React, { memo } from 'react';
import { ArrowLeft, Activity, Ambulance, Bus, CarFront, Clock3, Gauge, Bike, RadioTower, ShieldAlert, Truck } from 'lucide-react';
import { TrafficStats, LaneState } from '../hooks/useTrafficSimulation';
import { LaneLiveSnapshot } from './LaneCard';
import { CameraFeed } from '../lib/cameraFeeds';

interface AnalysisDashboardProps {
  stats: TrafficStats;
  lanes: LaneState[];
  selectedCameras: CameraFeed[];
  liveLaneSnapshots: Record<number, LaneLiveSnapshot>;
  historicalDensity: Array<{
    time: string;
    totalDetections: number;
    activeAmbulances: number;
  }>;
  onBack: () => void;
}

function HUDStat({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
      <div className={`absolute inset-x-0 top-0 h-[2px] ${accent}`} />
      <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{label}</div>
          <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
        </div>
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300">{icon}</div>
      </div>
    </div>
  );
}

function SignalPill({ light }: { light: LaneState['light'] }) {
  const classes =
    light === 'green'
      ? 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30'
      : light === 'yellow'
        ? 'bg-amber-400/15 text-amber-300 border-amber-400/30'
        : 'bg-rose-400/15 text-rose-300 border-rose-400/30';

  return <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${classes}`}>{light}</span>;
}

function DataMeter({
  label,
  value,
  maxValue,
  barClass,
}: {
  label: string;
  value: number;
  maxValue: number;
  barClass: string;
}) {
  const percentage = maxValue > 0 ? Math.min(100, Math.round((value / maxValue) * 100)) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold text-white">{value}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${barClass} shadow-[0_0_20px_rgba(34,211,238,0.25)]`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

export const AnalysisDashboard = memo(function AnalysisDashboard({
  stats,
  lanes,
  selectedCameras,
  liveLaneSnapshots,
  historicalDensity,
  onBack,
}: AnalysisDashboardProps) {
  const laneDetails = lanes.map((lane, index) => {
    const snapshot = liveLaneSnapshots[lane.id];
    return {
      id: lane.id,
      name: selectedCameras[index]?.name ?? `Lane ${index + 1}`,
      light: lane.light,
      liveCount: snapshot?.detectedCount ?? 0,
      ambulance: snapshot?.hasAmbulance ?? false,
      updatedAt: snapshot ? new Date(snapshot.updatedAt).toLocaleTimeString() : '--',
      greenTime: lane.greenTimeRemaining,
    };
  });

  const liveVehicleCounts = Object.values(liveLaneSnapshots).reduce(
    (accumulator, snapshot) => {
      snapshot.detections.forEach((detection) => {
        if (detection.label === 'car') accumulator.car += 1;
        if (detection.label === 'motorcycle') accumulator.motorcycle += 1;
        if (detection.label === 'bus') accumulator.bus += 1;
        if (detection.label === 'truck') accumulator.truck += 1;
        if (detection.label === 'ambulance') accumulator.ambulance += 1;
      });
      return accumulator;
    },
    { car: 0, motorcycle: 0, bus: 0, truck: 0, ambulance: 0 }
  );

  const maxLiveDensity = Math.max(1, ...laneDetails.map((lane) => lane.liveCount));
  const maxVehicleMetric = Math.max(1, ...Object.values(liveVehicleCounts));
  const latestHistory = historicalDensity[historicalDensity.length - 1];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08),transparent_22%),linear-gradient(180deg,#020617_0%,#081122_45%,#030712_100%)] p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="relative overflow-hidden rounded-[28px] border border-cyan-400/15 bg-slate-950/85 px-6 py-6 shadow-[0_30px_90px_rgba(2,6,23,0.55)]">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.05),transparent)]" />
          <div className="absolute -left-16 top-0 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/15"
              >
                <ArrowLeft size={18} />
                Back to Live Feeds
              </button>
              <div>
                <div className="text-[11px] uppercase tracking-[0.32em] text-cyan-300/80">SmartFlow Command Matrix</div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white md:text-4xl">Analysis Dashboard</h1>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Feed Sync</div>
                <div className="mt-2 text-lg font-semibold text-emerald-300">Live</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Selected Feeds</div>
                <div className="mt-2 text-lg font-semibold text-white">{selectedCameras.length}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Tracked Vehicles</div>
                <div className="mt-2 text-lg font-semibold text-cyan-300">{latestHistory?.totalDetections ?? 0}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Emergency Count</div>
                <div className="mt-2 text-lg font-semibold text-rose-300">{latestHistory?.activeAmbulances ?? 0}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <HUDStat label="Vehicles Processed" value={stats.totalVehicles.toLocaleString()} icon={<Activity size={20} />} accent="bg-cyan-400" />
          <HUDStat label="Average Wait" value={`${stats.averageWaitTime.toFixed(1)}s`} icon={<Clock3 size={20} />} accent="bg-amber-400" />
          <HUDStat label="Active Detections" value={latestHistory?.totalDetections ?? 0} icon={<RadioTower size={20} />} accent="bg-emerald-400" />
          <HUDStat label="Active Ambulances" value={latestHistory?.activeAmbulances ?? 0} icon={<ShieldAlert size={20} />} accent="bg-rose-400" />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_0.9fr]">
          <section className="rounded-[26px] border border-cyan-400/15 bg-slate-950/80 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)]">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.26em] text-cyan-300/75">Realtime Lanes</div>
                <h2 className="mt-2 text-2xl font-semibold text-white">Live Lane Status</h2>
              </div>
              <Gauge className="text-cyan-300" size={22} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {laneDetails.map((lane) => (
                <div key={lane.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-white">{lane.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">Last sync {lane.updatedAt}</div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <SignalPill light={lane.light} />
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                        lane.ambulance
                          ? 'border-rose-400/30 bg-rose-400/15 text-rose-300'
                          : 'border-slate-700 bg-slate-800 text-slate-300'
                      }`}>
                        Ambulance {lane.ambulance ? 'Yes' : 'No'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    <DataMeter label="Live vehicles" value={lane.liveCount} maxValue={maxLiveDensity} barClass="bg-gradient-to-r from-cyan-400 to-blue-500" />
                    <div className="flex items-center justify-between rounded-xl border border-cyan-400/10 bg-slate-950/70 px-4 py-3">
                      <span className="text-sm text-slate-300">Signal countdown</span>
                      <span className="font-mono text-lg font-semibold text-cyan-300">{lane.greenTime > 0 ? lane.greenTime : '--'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[26px] border border-cyan-400/15 bg-slate-950/80 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)]">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.26em] text-cyan-300/75">Detector Mix</div>
                <h2 className="mt-2 text-2xl font-semibold text-white">Vehicle Distribution</h2>
              </div>
              <CarFront className="text-cyan-300" size={22} />
            </div>
            <div className="space-y-4">
              <DataMeter label="Cars" value={liveVehicleCounts.car} maxValue={maxVehicleMetric} barClass="bg-gradient-to-r from-sky-400 to-cyan-400" />
              <DataMeter label="Motorcycles" value={liveVehicleCounts.motorcycle} maxValue={maxVehicleMetric} barClass="bg-gradient-to-r from-violet-400 to-fuchsia-500" />
              <DataMeter label="Buses" value={liveVehicleCounts.bus} maxValue={maxVehicleMetric} barClass="bg-gradient-to-r from-amber-400 to-orange-500" />
              <DataMeter label="Trucks" value={liveVehicleCounts.truck} maxValue={maxVehicleMetric} barClass="bg-gradient-to-r from-emerald-400 to-teal-500" />
              <DataMeter label="Ambulances" value={liveVehicleCounts.ambulance} maxValue={maxVehicleMetric} barClass="bg-gradient-to-r from-rose-400 to-red-500" />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-slate-200">
                <div className="flex items-center gap-2 text-sm"><CarFront size={16} className="text-sky-300" /> Cars</div>
                <div className="mt-2 text-2xl font-semibold">{liveVehicleCounts.car}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-slate-200">
                <div className="flex items-center gap-2 text-sm"><Bike size={16} className="text-violet-300" /> Bikes</div>
                <div className="mt-2 text-2xl font-semibold">{liveVehicleCounts.motorcycle}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-slate-200">
                <div className="flex items-center gap-2 text-sm"><Bus size={16} className="text-amber-300" /> Buses</div>
                <div className="mt-2 text-2xl font-semibold">{liveVehicleCounts.bus}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-slate-200">
                <div className="flex items-center gap-2 text-sm"><Truck size={16} className="text-emerald-300" /> Trucks</div>
                <div className="mt-2 text-2xl font-semibold">{liveVehicleCounts.truck}</div>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-[26px] border border-cyan-400/15 bg-slate-950/80 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.26em] text-cyan-300/75">Controller Archive</div>
              <h2 className="mt-2 text-2xl font-semibold text-white">Cumulative Vehicles Passed</h2>
            </div>
            <Activity className="text-cyan-300" size={22} />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-slate-900/90 text-slate-300">
                <tr>
                  <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em]">Lane</th>
                  <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em]">Cars</th>
                  <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em]">Buses</th>
                  <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em]">Trucks</th>
                  <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em]">Motorcycles</th>
                  <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em]">Ambulances</th>
                  <th className="px-4 py-4 text-xs font-semibold uppercase tracking-[0.18em]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-slate-950/40">
                {stats.laneStats.map((stat, index) => (
                  <tr key={index} className="text-slate-200 transition hover:bg-cyan-400/5">
                    <td className="px-4 py-4 font-medium text-white">{selectedCameras[index]?.name ?? `Lane ${index + 1}`}</td>
                    <td className="px-4 py-4">{stat.cars}</td>
                    <td className="px-4 py-4">{stat.buses}</td>
                    <td className="px-4 py-4">{stat.trucks}</td>
                    <td className="px-4 py-4">{stat.motorcycles}</td>
                    <td className="px-4 py-4">{stat.ambulances}</td>
                    <td className="px-4 py-4 font-semibold text-cyan-300">{stat.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[26px] border border-cyan-400/15 bg-slate-950/80 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.45)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.26em] text-cyan-300/75">Telemetry Buffer</div>
              <h2 className="mt-2 text-2xl font-semibold text-white">Recent Live History</h2>
            </div>
            <RadioTower className="text-cyan-300" size={22} />
          </div>
          <div className="grid gap-3">
            {historicalDensity.slice(-8).reverse().map((point) => (
              <div
                key={`${point.time}-${point.totalDetections}-${point.activeAmbulances}`}
                className="grid items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/65 px-4 py-4 text-slate-200 md:grid-cols-[1fr_1.2fr_1fr]"
              >
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Timestamp</div>
                  <div className="mt-1 font-semibold text-white">{point.time}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Detected Vehicles</div>
                  <div className="mt-1 font-semibold text-cyan-300">{point.totalDetections}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Active Ambulances</div>
                  <div className="mt-1 font-semibold text-rose-300">{point.activeAmbulances}</div>
                </div>
              </div>
            ))}
            {historicalDensity.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 px-4 py-8 text-center text-slate-400">
                Waiting for live dashboard data...
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
});
