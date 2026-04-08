from __future__ import annotations

import argparse
from pathlib import Path

import cv2


def extract_frames(video_path: Path, output_dir: Path, frames_per_video: int) -> int:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
      raise RuntimeError(f"Could not open video: {video_path}")

    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        raise RuntimeError(f"Could not read frame count for: {video_path}")

    frames_to_save = max(1, min(frames_per_video, total_frames))
    step = max(total_frames // frames_to_save, 1)
    saved = 0
    frame_index = 0
    stem = video_path.stem

    output_dir.mkdir(parents=True, exist_ok=True)

    while True:
        success, frame = capture.read()
        if not success:
            break

        if frame_index % step == 0 and saved < frames_to_save:
            output_path = output_dir / f"{stem}_{saved:04d}.jpg"
            cv2.imwrite(str(output_path), frame)
            saved += 1

        frame_index += 1

    capture.release()
    return saved


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract evenly spaced frames from traffic videos.")
    parser.add_argument("--video-dir", type=Path, required=True, help="Directory containing source videos.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory to save extracted frames.")
    parser.add_argument(
        "--frames-per-video",
        type=int,
        default=300,
        help="Number of frames to save from each input video.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    videos = sorted(args.video_dir.glob("*.mp4"))
    if not videos:
        raise FileNotFoundError(f"No .mp4 files found in {args.video_dir}")

    total_saved = 0
    for video_path in videos:
        saved = extract_frames(video_path, args.output_dir, args.frames_per_video)
        total_saved += saved
        print(f"Extracted {saved} frames from {video_path.name}")

    print(f"Done. Saved {total_saved} frames to {args.output_dir}")


if __name__ == "__main__":
    main()
