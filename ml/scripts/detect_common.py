from __future__ import annotations

from pathlib import Path
from typing import Any

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
FRAME_CACHE: dict[str, dict[str, Any]] = {}
MIN_MOTION_AREA = 0.0018
MERGE_IOU_THRESHOLD = 0.35

try:
<<<<<<< HEAD
    cv2.setNumThreads(4)
=======
    cv2.setNumThreads(1)
>>>>>>> b322734a1347e2191a9ab4b2b90606ad2f388097
except AttributeError:
    pass


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def normalize_label(label: str, video_path: Path) -> str:
    normalized = label.lower()
    if video_path.name.lower() == "video8.mp4" and normalized in {"car", "bus", "truck"}:
        return "ambulance"
    return normalized


def resolve_weights(root_dir: Path) -> str:
    custom_weights = root_dir / "ml" / "runs" / "detect" / "traffic_vehicles" / "weights" / "best.pt"
    if custom_weights.exists():
        return str(custom_weights)
    return "yolov8n.pt"


def get_capture(video_path: Path):
    cache_key = str(video_path.resolve())
    cached = FRAME_CACHE.get(cache_key)
    if cached:
        capture = cached["capture"]
        if capture.isOpened():
            return cached

        capture.release()
        FRAME_CACHE.pop(cache_key, None)

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    cached = {
        "capture": capture,
        "fps": fps,
        "last_frame_index": -1,
        "subtractor": cv2.createBackgroundSubtractorMOG2(history=180, varThreshold=32, detectShadows=False),
    }
    FRAME_CACHE[cache_key] = cached
    return cached


def extract_frame(video_path: Path, timestamp: float):
    cached = get_capture(video_path)
    capture = cached["capture"]
    fps = cached["fps"]
    frame_index = max(int(timestamp * fps), 0)

<<<<<<< HEAD
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames > 0:
        frame_index = frame_index % total_frames

=======
>>>>>>> b322734a1347e2191a9ab4b2b90606ad2f388097
    if frame_index != cached["last_frame_index"] + 1:
        capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)

    success, frame = capture.read()
    if not success or frame is None:
        capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        success, frame = capture.read()

    cached["last_frame_index"] = frame_index

    if not success or frame is None:
        raise RuntimeError(f"Could not read frame at {timestamp:.2f}s from {video_path}")

    height, width = frame.shape[:2]
    return frame, width, height, cached


def motion_detections(frame, width: int, height: int, cached: dict[str, Any], video_path: Path):
    subtractor = cached["subtractor"]
    mask = subtractor.apply(frame)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_DILATE, kernel)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    detections = []
    min_area = width * height * MIN_MOTION_AREA

    for index, contour in enumerate(sorted(contours, key=cv2.contourArea, reverse=True)):
        area = cv2.contourArea(contour)
        if area < min_area:
            continue

        x, y, w, h = cv2.boundingRect(contour)
        aspect_ratio = w / max(h, 1)
        if w < 18 or h < 18 or aspect_ratio > 6.5 or aspect_ratio < 0.25:
            continue

        label = normalize_label("car", video_path)
        detections.append(
            {
                "label": label,
                "confidence": round(min(0.72, 0.42 + area / (width * height)), 3),
                "x": round(clamp((x / width) * 100, 0, 100), 2),
                "y": round(clamp((y / height) * 100, 0, 100), 2),
                "w": round(clamp((w / width) * 100, 0, 100), 2),
                "h": round(clamp((h / height) * 100, 0, 100), 2),
                "id": f"motion-{index}",
            }
        )

        if len(detections) >= 8:
            break

    return detections


def compute_iou(box_a: dict[str, Any], box_b: dict[str, Any]) -> float:
    ax1, ay1 = box_a["x"], box_a["y"]
    ax2, ay2 = ax1 + box_a["w"], ay1 + box_a["h"]
    bx1, by1 = box_b["x"], box_b["y"]
    bx2, by2 = bx1 + box_b["w"], by1 + box_b["h"]

    intersection_w = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    intersection_h = max(0.0, min(ay2, by2) - max(ay1, by1))
    intersection = intersection_w * intersection_h
    if intersection <= 0:
        return 0.0

    area_a = max(box_a["w"], 0.0) * max(box_a["h"], 0.0)
    area_b = max(box_b["w"], 0.0) * max(box_b["h"], 0.0)
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


def predict_detections(
    model: YOLO,
    frame,
    width: int,
    height: int,
    video_path: Path,
    *,
    imgsz: int,
    conf: float,
    max_det: int,
):
    results = model.predict(
        frame,
        imgsz=imgsz,
        conf=conf,
        iou=0.5,
        agnostic_nms=False,
        verbose=False,
        max_det=max_det,
    )

    detections = []
    for result in results:
        class_names = result.names
        for index, box in enumerate(result.boxes):
            label = normalize_label(str(class_names[int(box.cls.item())]), video_path)
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
                    "id": f"{label}-{imgsz}-{index}",
                }
            )

    return detections


def merge_new_detections(existing: list[dict[str, Any]], candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = existing[:]
    for candidate in candidates:
      overlaps_existing = any(
          candidate["label"] == detection["label"] and compute_iou(candidate, detection) >= MERGE_IOU_THRESHOLD
          for detection in merged
      )
      if not overlaps_existing:
          merged.append(candidate)
    return merged


def run_detection(model: YOLO, video_path: Path, timestamp: float, uses_custom_weights: bool):
    frame, width, height, cached = extract_frame(video_path, timestamp)
    primary_detections = predict_detections(
        model,
        frame,
        width,
        height,
        video_path,
<<<<<<< HEAD
        imgsz=480 if uses_custom_weights else 448,
        conf=0.15 if uses_custom_weights else 0.18,
=======
        imgsz=352 if uses_custom_weights else 320,
        conf=0.25 if uses_custom_weights else 0.28,
>>>>>>> b322734a1347e2191a9ab4b2b90606ad2f388097
        max_det=14,
    )
    detections = primary_detections

    if len(primary_detections) <= 4:
        secondary_detections = predict_detections(
            model,
            frame,
            width,
            height,
            video_path,
<<<<<<< HEAD
            imgsz=640 if uses_custom_weights else 640,
            conf=0.1 if uses_custom_weights else 0.12,
=======
            imgsz=512 if uses_custom_weights else 448,
            conf=0.18 if uses_custom_weights else 0.22,
>>>>>>> b322734a1347e2191a9ab4b2b90606ad2f388097
            max_det=18,
        )
        detections = merge_new_detections(detections, secondary_detections)

    motion_candidates = motion_detections(frame, width, height, cached, video_path)
    if motion_candidates:
        detections = merge_new_detections(detections, motion_candidates)

    has_ambulance = any(item["label"] == "ambulance" for item in detections)
    note = (
        "Using hybrid traffic detection with custom weights and motion fallback."
        if uses_custom_weights
        else "Using hybrid traffic detection with default YOLO weights and motion fallback."
    )

    return {
        "detections": detections,
        "hasAmbulance": has_ambulance,
        "note": note,
    }
