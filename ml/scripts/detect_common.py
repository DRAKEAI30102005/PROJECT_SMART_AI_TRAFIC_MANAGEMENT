from __future__ import annotations

from pathlib import Path

try:
    import cv2
except ImportError as exc:
    raise RuntimeError(
        "OpenCV is not installed. Run `pip install -r ml/requirements.txt` and restart the detection API."
    ) from exc

try:
    from ultralytics import YOLO
except ImportError as exc:
    raise RuntimeError(
        "Ultralytics is not installed. Run `pip install -r ml/requirements.txt` and restart the detection API."
    ) from exc


TARGET_CLASSES = {"car", "motorcycle", "bus", "truck", "ambulance"}


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def resolve_weights(root_dir: Path) -> str:
    custom_weights = root_dir / "ml" / "runs" / "detect" / "traffic_vehicles" / "weights" / "best.pt"
    if custom_weights.exists():
        return str(custom_weights)
    return "yolov8n.pt"


def extract_frame(video_path: Path, timestamp: float):
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    frame_index = max(int(timestamp * fps), 0)
    capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    success, frame = capture.read()
    capture.release()

    if not success or frame is None:
        raise RuntimeError(f"Could not read frame at {timestamp:.2f}s from {video_path}")

    height, width = frame.shape[:2]
    return frame, width, height


def run_detection(model: YOLO, video_path: Path, timestamp: float, uses_custom_weights: bool):
    frame, width, height = extract_frame(video_path, timestamp)
    results = model.predict(
        frame,
        imgsz=1280 if uses_custom_weights else 960,
        conf=0.22 if uses_custom_weights else 0.25,
        iou=0.55,
        agnostic_nms=False,
        verbose=False,
    )

    detections = []
    for result in results:
        class_names = result.names
        for index, box in enumerate(result.boxes):
            label = str(class_names[int(box.cls.item())]).lower()
            if label not in TARGET_CLASSES:
                continue

            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append(
                {
                    "label": label,
                    "confidence": round(float(box.conf.item()), 3),
                    "x": round(clamp((x1 / width) * 100, 0, 100), 2),
                    "y": round(clamp((y1 / height) * 100, 0, 100), 2),
                    "w": round(clamp(((x2 - x1) / width) * 100, 0, 100), 2),
                    "h": round(clamp(((y2 - y1) / height) * 100, 0, 100), 2),
                    "id": f"{label}-{index}",
                }
            )

    has_ambulance = any(item["label"] == "ambulance" for item in detections)
    note = (
        "Using custom traffic weights. Ambulance detection will still need labeled ambulance examples to become reliable."
        if uses_custom_weights
        else "Using default YOLO weights. Ambulance detection needs your trained custom model."
    )

    return {
        "detections": detections,
        "hasAmbulance": has_ambulance,
        "note": note,
    }
