/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { AdminLogin } from './components/AdminLogin';
import { Home } from './components/Home';
import { CCTVSelector } from './components/CCTVSelector';
import { ModelTraining } from './components/ModelTraining';
import { CameraFeed } from './lib/cameraFeeds';
import { type SharedDetectionFrame, fetchDetectionFrame } from './lib/detectionApi';

type ViewState = 'login' | 'home' | 'selector' | 'dashboard' | 'training';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>('login');
  const [selectedCameras, setSelectedCameras] = useState<CameraFeed[]>([]);
  const [bootstrapDetections, setBootstrapDetections] = useState<Record<number, SharedDetectionFrame>>({});

  if (currentView === 'login') {
    return <AdminLogin onLogin={() => setCurrentView('home')} />;
  }

  if (currentView === 'home') {
    return <Home onNavigateToDashboard={() => setCurrentView('selector')} />;
  }

  if (currentView === 'selector') {
    return (
      <CCTVSelector 
        onStart={(cameras) => {
          setSelectedCameras(cameras);
          setBootstrapDetections({});
          cameras.forEach((camera, index) => {
            const startupTime = camera.videoFile === 'video8.mp4' ? 0.6 : 0.35;
            void fetchDetectionFrame(camera.videoFile, startupTime)
              .then((payload) => {
                setBootstrapDetections((previous) => ({
                  ...previous,
                  [index]: {
                    timeInSeconds: startupTime,
                    payload,
                    updatedAt: Date.now(),
                  },
                }));
              })
              .catch(() => {
                // Dashboard bootstrap will retry immediately after mount.
              });
          });
          setCurrentView('dashboard');
        }} 
      />
    );
  }

  if (currentView === 'training') {
    return <ModelTraining onBack={() => setCurrentView('home')} />;
  }

  return (
    <Dashboard 
      onLogout={() => setCurrentView('login')} 
      selectedCameras={selectedCameras} 
      initialSharedDetections={bootstrapDetections}
      onChangeFootage={() => setCurrentView('selector')}
      onGoHome={() => setCurrentView('home')}
    />
  );
}
