import React, { useState } from 'react';
import { Video, CheckCircle2 } from 'lucide-react';
import { AVAILABLE_CAMERA_FEEDS, CameraFeed } from '../lib/cameraFeeds';

interface CCTVSelectorProps {
  onStart: (selectedFeeds: CameraFeed[]) => void;
}

export function CCTVSelector({ onStart }: CCTVSelectorProps) {
  const [selected, setSelected] = useState<CameraFeed[]>([]);

  const toggleSelection = (camera: CameraFeed) => {
    if (selected.some((item) => item.id === camera.id)) {
      setSelected(selected.filter((item) => item.id !== camera.id));
    } else if (selected.length < 4) {
      setSelected([...selected, camera]);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 flex flex-col items-center justify-center">
      <div className="max-w-5xl w-full bg-white p-8 rounded-3xl shadow-xl border border-gray-100">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Select CCTV Feeds</h2>
          <p className="text-gray-600 mt-2">Please select exactly 4 camera feeds to monitor in the dashboard.</p>
          <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full font-medium">
            <Video size={20} />
            <span>{selected.length} / 4 Selected</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {AVAILABLE_CAMERA_FEEDS.map((cam) => {
            const isSelected = selected.some((item) => item.id === cam.id);
            const isDisabled = !isSelected && selected.length >= 4;
            
            return (
              <button
                key={cam.id}
                onClick={() => toggleSelection(cam)}
                disabled={isDisabled}
                className={`relative p-6 rounded-xl border-2 text-left transition-all duration-200 ${
                  isSelected 
                    ? 'border-blue-500 bg-blue-50 shadow-md' 
                    : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
                } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-3 rounded-lg ${isSelected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <Video size={24} />
                  </div>
                  {isSelected && <CheckCircle2 className="text-blue-500" size={24} />}
                </div>
                <h3 className={`font-bold ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                  {cam.name}
                </h3>
                <p className="text-sm text-gray-500 mt-1">Source: {cam.videoFile}</p>
              </button>
            );
          })}
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => onStart(selected)}
            disabled={selected.length !== 4}
            className={`px-12 py-4 rounded-full font-bold text-xl transition-all duration-300 shadow-lg flex items-center gap-2 ${
              selected.length === 4 
                ? 'bg-green-500 hover:bg-green-600 text-white hover:scale-105' 
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            START
          </button>
        </div>
      </div>
    </div>
  );
}
