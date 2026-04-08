from __future__ import annotations

import json
import sys
from pathlib import Path

from ultralytics import YOLO

from detect_common import resolve_weights, run_detection


def emit(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    weights = resolve_weights(root_dir)
    model = YOLO(weights)
    uses_custom_weights = str(weights).endswith("best.pt")

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
