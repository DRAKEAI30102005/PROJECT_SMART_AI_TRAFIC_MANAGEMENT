import { useState, useEffect, useRef, useCallback } from 'react';

export type VehicleType = 'car' | 'motorcycle' | 'bus' | 'truck' | 'ambulance';

export interface Vehicle {
  id: string;
  type: VehicleType;
  lane: number;
  arrivalTime: number;
}

export type LightState = 'red' | 'yellow' | 'green';

export interface LaneState {
  id: number;
  name: string;
  light: LightState;
  queue: Vehicle[];
  density: number; // 0 to 100
  greenTimeRemaining: number;
  greenPhaseDuration: number;
  hasAmbulance: boolean;
  videoAmbulanceDetected: boolean;
}

export interface LaneStat {
  cars: number;
  buses: number;
  trucks: number;
  motorcycles: number;
  ambulances: number;
  total: number;
}

export interface TrafficStats {
  totalVehicles: number;
  vehiclesByType: Record<VehicleType, number>;
  averageWaitTime: number;
  ambulancesDetected: number;
  congestionReduced: number; // percentage
  laneStats: LaneStat[];
}

const LANES = ['North', 'East', 'South', 'West'];
const MIN_GREEN_TIME = 12;
const MAX_GREEN_TIME = 20;
const YELLOW_TIME = 3;
const TIME_PER_VEHICLE = 1;

export function useTrafficSimulation() {
  const [lanes, setLanes] = useState<LaneState[]>(
    LANES.map((name, index) => ({
      id: index,
      name,
      light: index === 0 ? 'green' : 'red',
      queue: [],
      density: 0,
      greenTimeRemaining: index === 0 ? MIN_GREEN_TIME : 0,
      greenPhaseDuration: index === 0 ? MIN_GREEN_TIME : 0,
      hasAmbulance: false,
      videoAmbulanceDetected: false,
    }))
  );

  const [stats, setStats] = useState<TrafficStats>({
    totalVehicles: 0,
    vehiclesByType: { car: 0, motorcycle: 0, bus: 0, truck: 0, ambulance: 0 },
    averageWaitTime: 0,
    ambulancesDetected: 0,
    congestionReduced: 85,
    laneStats: Array(4).fill(null).map(() => ({ cars: 0, buses: 0, trucks: 0, motorcycles: 0, ambulances: 0, total: 0 })),
  });

  const [activeLaneIndex, setActiveLaneIndex] = useState(0);
  const [isAmbulanceOverride, setIsAmbulanceOverride] = useState(false);
  const [ambulanceAlert, setAmbulanceAlert] = useState<string | null>(null);

  const totalWaitTimeRef = useRef(0);
  const processedVehiclesRef = useRef(0);
  const activeLaneIndexRef = useRef(activeLaneIndex);

  useEffect(() => {
    activeLaneIndexRef.current = activeLaneIndex;
  }, [activeLaneIndex]);

  const playAlertSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, ctx.currentTime); // High pitch
      osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.2); // Siren effect
      osc.frequency.setValueAtTime(800, ctx.currentTime + 0.4);
      osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.6);
      
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 1);
    } catch (e) {
      console.error("Audio playback failed", e);
    }
  }, []);

  // Helper to generate random vehicles
  const spawnVehicle = useCallback((laneIndex: number, forceAmbulance = false) => {
    const types: VehicleType[] = ['car', 'car', 'car', 'motorcycle', 'motorcycle', 'bus', 'truck'];
    const type = forceAmbulance ? 'ambulance' : types[Math.floor(Math.random() * types.length)];
    
    const vehicle: Vehicle = {
      id: Math.random().toString(36).substring(7),
      type,
      lane: laneIndex,
      arrivalTime: Date.now(),
    };

    setLanes(prev => {
      const newLanes = [...prev];
      newLanes[laneIndex] = {
        ...newLanes[laneIndex],
        queue: [...newLanes[laneIndex].queue, vehicle],
        density: Math.min(100, (newLanes[laneIndex].queue.length + 1) * 10),
        hasAmbulance: newLanes[laneIndex].hasAmbulance || type === 'ambulance',
      };
      return newLanes;
    });

    if (type === 'ambulance') {
      setStats(prev => ({ ...prev, ambulancesDetected: prev.ambulancesDetected + 1 }));
      setAmbulanceAlert(`Ambulance detected in ${LANES[laneIndex]} lane! Prioritizing signal.`);
      playAlertSound();
      setTimeout(() => setAmbulanceAlert(null), 5000);
    }
  }, [playAlertSound]);

  // Simulate random arrivals
  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.3) {
        const randomLane = Math.floor(Math.random() * 4);
        spawnVehicle(randomLane);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [spawnVehicle]);

  // Process vehicles passing through green light
  useEffect(() => {
    const interval = setInterval(() => {
      setLanes(prev => {
        const newLanes = [...prev];
        const processedVehicles: Array<{ vehicle: Vehicle; laneIndex: number; waitTime: number }> = [];

        newLanes.forEach((lane, index) => {
          if (lane.light === 'green' && lane.queue.length > 0) {
            // Process one vehicle
            const vehicle = lane.queue[0];
            const waitTime = (Date.now() - vehicle.arrivalTime) / 1000;
            processedVehicles.push({ vehicle, laneIndex: index, waitTime });

            lane.queue = lane.queue.slice(1);
            lane.density = Math.max(0, lane.queue.length * 10);

            lane.hasAmbulance = lane.queue.some(v => v.type === 'ambulance');
          }
        });

        if (processedVehicles.length > 0) {
          setStats((prevStats) => {
            const nextStats: TrafficStats = {
              ...prevStats,
              totalVehicles: prevStats.totalVehicles,
              vehiclesByType: { ...prevStats.vehiclesByType },
              laneStats: prevStats.laneStats.map((laneStat) => ({ ...laneStat })),
            };

            processedVehicles.forEach(({ vehicle, laneIndex, waitTime }) => {
              totalWaitTimeRef.current += waitTime;
              processedVehiclesRef.current += 1;

              nextStats.totalVehicles += 1;
              nextStats.vehiclesByType[vehicle.type] += 1;

              const laneStat = nextStats.laneStats[laneIndex];
              if (vehicle.type === 'car') laneStat.cars += 1;
              if (vehicle.type === 'bus') laneStat.buses += 1;
              if (vehicle.type === 'truck') laneStat.trucks += 1;
              if (vehicle.type === 'motorcycle') laneStat.motorcycles += 1;
              if (vehicle.type === 'ambulance') laneStat.ambulances += 1;
              laneStat.total += 1;
            });

            nextStats.averageWaitTime = totalWaitTimeRef.current / processedVehiclesRef.current;
            return nextStats;
          });
        }
        return newLanes;
      });
    }, 800); // 1 vehicle every 0.8s on green
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setLanes((prev) => {
        const nextLanes = prev.map((lane) => ({ ...lane }));
        const laneHasPriorityAmbulance = (lane: LaneState) => lane.hasAmbulance || lane.videoAmbulanceDetected;
        const ambulanceLaneIndex = nextLanes.findIndex((lane) => laneHasPriorityAmbulance(lane));
        const currentActiveLaneIndex = activeLaneIndexRef.current;
        const currentLane = nextLanes[currentActiveLaneIndex];

        if (!currentLane) {
          return prev;
        }

        const nextIsOverride = ambulanceLaneIndex !== -1;
        if (nextIsOverride !== isAmbulanceOverride) {
          setIsAmbulanceOverride(nextIsOverride);
        }

        if (nextIsOverride) {
          if (ambulanceLaneIndex !== currentActiveLaneIndex) {
            nextLanes[currentActiveLaneIndex] = {
              ...currentLane,
              light: 'red',
              greenTimeRemaining: 0,
            };

            nextLanes[ambulanceLaneIndex] = {
              ...nextLanes[ambulanceLaneIndex],
              light: 'green',
              greenTimeRemaining: MAX_GREEN_TIME,
              greenPhaseDuration: MAX_GREEN_TIME,
            };

            setActiveLaneIndex(ambulanceLaneIndex);
            return nextLanes;
          }

          nextLanes[currentActiveLaneIndex] = {
            ...currentLane,
            light: 'green',
            greenTimeRemaining: MAX_GREEN_TIME,
            greenPhaseDuration: MAX_GREEN_TIME,
          };
          return nextLanes;
        }

        if (currentLane.light === 'yellow') {
          const nextRemaining = Math.max(0, currentLane.greenTimeRemaining - 1);
          nextLanes[currentActiveLaneIndex] = {
            ...currentLane,
            greenTimeRemaining: nextRemaining,
          };

          if (nextRemaining === 0) {
            let nextLaneIndex = (currentActiveLaneIndex + 1) % nextLanes.length;
            let maxDensity = -1;

            nextLanes.forEach((lane, index) => {
              if (index !== currentActiveLaneIndex && lane.density > maxDensity) {
                maxDensity = lane.density;
                nextLaneIndex = index;
              }
            });

            if (maxDensity <= 0) {
              nextLaneIndex = (currentActiveLaneIndex + 1) % nextLanes.length;
            }

            nextLanes[currentActiveLaneIndex] = {
              ...nextLanes[currentActiveLaneIndex],
              light: 'red',
            };

            const nextLane = nextLanes[nextLaneIndex];
            const calculatedTime = MIN_GREEN_TIME + (nextLane.queue.length * TIME_PER_VEHICLE);
            const boundedTime = Math.min(MAX_GREEN_TIME, Math.max(MIN_GREEN_TIME, calculatedTime));

            nextLanes[nextLaneIndex] = {
              ...nextLane,
              light: 'green',
              greenTimeRemaining: boundedTime,
              greenPhaseDuration: boundedTime,
            };

            setActiveLaneIndex(nextLaneIndex);
          }

          return nextLanes;
        }

        if (currentLane.light === 'green') {
          const nextRemaining = Math.max(0, currentLane.greenTimeRemaining - 1);
          const elapsedGreen = currentLane.greenPhaseDuration - nextRemaining;
          const shouldSwitchToYellow =
            nextRemaining === 0 ||
            (currentLane.queue.length === 0 && elapsedGreen >= MIN_GREEN_TIME);

          nextLanes[currentActiveLaneIndex] = {
            ...currentLane,
            greenTimeRemaining: shouldSwitchToYellow ? YELLOW_TIME : nextRemaining,
            light: shouldSwitchToYellow ? 'yellow' : 'green',
          };
        }

        return nextLanes;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isAmbulanceOverride]);

  const triggerAmbulance = (laneIndex: number) => {
    spawnVehicle(laneIndex, true);
  };

  const updateVideoAmbulanceDetection = (laneIndex: number, detected: boolean) => {
    setLanes((prev) => {
      const next = [...prev];
      next[laneIndex] = {
        ...next[laneIndex],
        videoAmbulanceDetected: detected,
      };
      return next;
    });
  };

  return {
    lanes,
    stats,
    ambulanceAlert,
    triggerAmbulance,
    isAmbulanceOverride,
    updateVideoAmbulanceDetection,
  };
}
