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

type ViewState = 'login' | 'home' | 'selector' | 'dashboard' | 'training';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>('login');
  const [selectedCameras, setSelectedCameras] = useState<CameraFeed[]>([]);

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
      onChangeFootage={() => setCurrentView('selector')}
      onGoHome={() => setCurrentView('home')}
    />
  );
}
