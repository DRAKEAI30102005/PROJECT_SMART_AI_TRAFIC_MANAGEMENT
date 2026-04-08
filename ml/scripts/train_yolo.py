from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a YOLO model on the traffic vehicle dataset.")
    parser.add_argument("--data", type=Path, required=True, help="Path to dataset YAML file.")
    parser.add_argument("--model", default="yolov8m.pt", help="Base YOLO weights to start from.")
    parser.add_argument("--epochs", type=int, default=100, help="Number of training epochs.")
    parser.add_argument("--imgsz", type=int, default=1280, help="Training image size.")
    parser.add_argument("--batch", type=int, default=8, help="Training batch size.")
    parser.add_argument("--device", default="0", help="CUDA device index or cpu.")
    parser.add_argument("--project", type=Path, default=Path("ml/runs/detect"), help="Output project directory.")
    parser.add_argument("--name", default="traffic_vehicles", help="Run name.")
    parser.add_argument(
        "--cfg",
        type=Path,
        default=Path("ml/configs/yolo_high_accuracy.yaml"),
        help="YOLO training config file.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume the most recent run from the provided model/checkpoint.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not args.data.exists():
        raise FileNotFoundError(f"Dataset YAML not found: {args.data}")
    if args.cfg and not args.cfg.exists():
        raise FileNotFoundError(f"Training config not found: {args.cfg}")

    model = YOLO(args.model)
    if args.resume:
        results = model.train(resume=True)
    else:
        results = model.train(
            data=str(args.data),
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            device=args.device,
            project=str(args.project),
            name=args.name,
            pretrained=True,
            cache=False,
            workers=2,
            close_mosaic=10,
            patience=25,
            plots=True,
            exist_ok=True,
            cfg=str(args.cfg),
        )

    print("Training complete.")
    print(f"Best weights: {results.save_dir / 'weights' / 'best.pt'}")


if __name__ == "__main__":
    main()
