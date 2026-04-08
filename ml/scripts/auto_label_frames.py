from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


TARGET_CLASS_NAMES = ("car", "motorcycle", "bus", "truck")


def find_class_ids(model: YOLO) -> dict[int, str]:
    names = model.names
    valid_ids: dict[int, str] = {}
    for class_id, name in names.items():
        lowered = str(name).lower()
        if lowered in TARGET_CLASS_NAMES:
            valid_ids[int(class_id)] = lowered
    return valid_ids


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto-label frames with a base YOLO model.")
    parser.add_argument("--source", type=Path, required=True, help="Directory containing source images.")
    parser.add_argument("--images-out", type=Path, required=True, help="Directory to copy labeled images into.")
    parser.add_argument("--labels-out", type=Path, required=True, help="Directory to save YOLO txt labels into.")
    parser.add_argument("--model", default="yolov8m.pt", help="Base YOLO weights for pseudo-labeling.")
    parser.add_argument("--conf", type=float, default=0.35, help="Confidence threshold for pseudo-labels.")
    args = parser.parse_args()

    if not args.source.exists():
        raise FileNotFoundError(f"Source folder not found: {args.source}")

    model = YOLO(args.model)
    class_ids = find_class_ids(model)
    class_to_target_id = {"car": 0, "motorcycle": 1, "bus": 2, "truck": 3}

    args.images_out.mkdir(parents=True, exist_ok=True)
    args.labels_out.mkdir(parents=True, exist_ok=True)

    images = sorted(
        [path for path in args.source.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png"}]
    )
    kept_images = 0
    total_boxes = 0
    skipped_existing = 0

    for image_path in images:
        image_copy_path = args.images_out / image_path.name
        label_path = args.labels_out / f"{image_path.stem}.txt"

        if image_copy_path.exists() and label_path.exists():
            skipped_existing += 1
            continue

        results = model.predict(source=str(image_path), conf=args.conf, imgsz=1280, verbose=False)
        label_lines: list[str] = []

        for result in results:
            for box in result.boxes:
                class_id = int(box.cls.item())
                if class_id not in class_ids:
                    continue

                label_name = class_ids[class_id]
                target_id = class_to_target_id[label_name]
                x_center, y_center, width, height = box.xywhn[0].tolist()
                label_lines.append(
                    f"{target_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"
                )

        if not label_lines:
            continue

        kept_images += 1
        total_boxes += len(label_lines)
        image_copy_path.write_bytes(image_path.read_bytes())
        label_path.write_text("\n".join(label_lines) + "\n", encoding="utf-8")

    print(f"Auto-labeled {kept_images} images with {total_boxes} boxes.")
    print(f"Skipped {skipped_existing} images that were already labeled.")
    print("Review all labels carefully before training, especially small vehicles and occlusions.")
    print("Ambulance labels must still be added manually as class 4.")


if __name__ == "__main__":
    main()
