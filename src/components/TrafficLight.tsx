import React from 'react';
import { cn } from '../lib/utils';
import { LightState } from '../hooks/useTrafficSimulation';

interface TrafficLightProps {
  state: LightState;
  isBlinking?: boolean;
}

export function TrafficLight({ state, isBlinking }: TrafficLightProps) {
  return (
    <div className="flex flex-col items-center gap-2 bg-[#9ca3af] p-2 rounded-md border-2 border-gray-500 shadow-inner w-14 h-full justify-center">
      <div 
        className={cn(
          "w-8 h-8 rounded-full transition-all duration-300 border-2 border-gray-600",
          state === 'red' ? "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.8)]" : "bg-red-900 opacity-40"
        )} 
      />
      <div 
        className={cn(
          "w-8 h-8 rounded-full transition-all duration-300 border-2 border-gray-600",
          state === 'yellow' ? "bg-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.8)]" : "bg-yellow-900 opacity-40"
        )} 
      />
      <div 
        className={cn(
          "w-8 h-8 rounded-full transition-all duration-300 border-2 border-gray-600",
          state === 'green' ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.8)]" : "bg-green-900 opacity-40",
          isBlinking && state === 'green' ? "animate-pulse" : ""
        )} 
      />
    </div>
  );
}
