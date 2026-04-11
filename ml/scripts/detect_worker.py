from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

try:
    import torch
except ImportError:
    torch = None

from detect_common import resolve_weights, run_detection


def emit(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def load_model(root_dir: Path) -> tuple[YOLO, str, bool]:
    weights = resolve_weights(root_dir)
    uses_custom_weights = str(weights).endswith("best.pt")

    try:
        return YOLO(weights), str(weights), uses_custom_weights
    except Exception:
        if not uses_custom_weights:
            raise

    fallback_weights = str(root_dir / "yolov8m.pt") if (root_dir / "yolov8m.pt").exists() else "yolov8n.pt"
    return YOLO(fallback_weights), fallback_weights, False


def main() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    cv2.setNumThreads(1)
    if torch is not None:
        torch.set_num_threads(1)
        if hasattr(torch, "set_num_interop_threads"):
            torch.set_num_interop_threads(1)

    model, weights, uses_custom_weights = load_model(root_dir)
    warmup_frame = np.zeros((256, 384, 3), dtype=np.uint8)
    model.predict(
        warmup_frame,
        imgsz=320,
        conf=0.3,
        iou=0.5,
        agnostic_nms=False,
        verbose=False,
        max_det=6,
    )

    emit({"ready": True, "weights": weights, "custom": uses_custom_weights})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            payload = json.loads(line)
            request_id = str(payload["id"])
            video = str(payload["video"])
            timestamp = float(payload["time"])

            video_path = Path(video)
            if not video_path.is_absolute():
                video_path = root_dir / video_path

            if not video_path.exists():
                raise FileNotFoundError(f"Video not found: {video_path}")

            result = run_detection(model, video_path, timestamp, uses_custom_weights)
            emit({"id": request_id, "ok": True, "result": result})
        except Exception as exc:
            emit(
                {
                    "id": payload["id"] if "payload" in locals() and isinstance(payload, dict) and "id" in payload else None,
                    "ok": False,
                    "error": str(exc),
                }
            )


if __name__ == "__main__":
    main()
