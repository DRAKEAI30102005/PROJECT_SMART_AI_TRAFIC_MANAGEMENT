from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run YOLO inference on an image, folder, or video.")
    parser.add_argument("--weights", type=Path, required=True, help="Path to trained YOLO weights.")
    parser.add_argument("--source", type=Path, required=True, help="Image, video, or folder to analyze.")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold.")
    parser.add_argument("--imgsz", type=int, default=1280, help="Inference image size.")
    parser.add_argument("--project", type=Path, default=Path("ml/runs/predict"), help="Output directory.")
    parser.add_argument("--name", default="traffic_preview", help="Run name.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not args.weights.exists():
        raise FileNotFoundError(f"Weights not found: {args.weights}")
    if not args.source.exists():
        raise FileNotFoundError(f"Source not found: {args.source}")

    model = YOLO(str(args.weights))
    results = model.predict(
        source=str(args.source),
        conf=args.conf,
        imgsz=args.imgsz,
        project=str(args.project),
        name=args.name,
        save=True,
        exist_ok=True,
    )

    print(f"Inference complete. Processed {len(results)} result items.")


if __name__ == "__main__":
    main()
