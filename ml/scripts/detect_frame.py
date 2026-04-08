from __future__ import annotations

import argparse
import json
from pathlib import Path

from ultralytics import YOLO

from detect_common import resolve_weights, run_detection


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect vehicles in a single video frame using YOLO.")
    parser.add_argument("--video", type=Path, required=True, help="Path to the source video.")
    parser.add_argument("--time", type=float, required=True, help="Timestamp in seconds.")
    args = parser.parse_args()

    root_dir = Path(__file__).resolve().parents[2]
    video_path = args.video if args.video.is_absolute() else (root_dir / args.video)
    if not video_path.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")

    weights = resolve_weights(root_dir)
    model = YOLO(weights)
    uses_custom_weights = str(weights).endswith("best.pt")
    print(json.dumps(run_detection(model, video_path, args.time, uses_custom_weights)))


if __name__ == "__main__":
    main()
