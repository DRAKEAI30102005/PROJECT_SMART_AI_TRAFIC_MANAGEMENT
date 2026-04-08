export interface CameraFeed {
  id: string;
  name: string;
  videoFile: string;
}

export const AVAILABLE_CAMERA_FEEDS: CameraFeed[] = [
  { id: 'cam1', name: 'Junction A - North', videoFile: 'video1.mp4' },
  { id: 'cam2', name: 'Junction A - South', videoFile: 'video2.mp4' },
  { id: 'cam3', name: 'Junction A - East', videoFile: 'video3.mp4' },
  { id: 'cam4', name: 'Junction A - West', videoFile: 'video4.mp4' },
  { id: 'cam5', name: 'Highway 1 - Entry', videoFile: 'video5.mp4' },
  { id: 'cam6', name: 'Highway 1 - Exit', videoFile: 'video6.mp4' },
  { id: 'cam7', name: 'Downtown - Main St', videoFile: 'video7.mp4' },
  { id: 'cam8', name: 'Downtown - Cross St', videoFile: 'video8.mp4' },
];
