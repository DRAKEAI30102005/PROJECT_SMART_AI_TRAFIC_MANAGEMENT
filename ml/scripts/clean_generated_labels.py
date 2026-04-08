from __future__ import annotations

import argparse
from pathlib import Path


def parse_label_line(line: str):
    parts = line.strip().split()
    if len(parts) != 5:
        return None
    class_id = int(parts[0])
    x_center, y_center, width, height = map(float, parts[1:])
    return {
        "class_id": class_id,
        "x_center": x_center,
        "y_center": y_center,
        "width": width,
        "height": height,
        "area": width * height,
    }


def to_corners(box: dict[str, float]) -> tuple[float, float, float, float]:
    half_w = box["width"] / 2
    half_h = box["height"] / 2
    return (
        box["x_center"] - half_w,
        box["y_center"] - half_h,
        box["x_center"] + half_w,
        box["y_center"] + half_h,
    )


def iou(box_a: dict[str, float], box_b: dict[str, float]) -> float:
    ax1, ay1, ax2, ay2 = to_corners(box_a)
    bx1, by1, bx2, by2 = to_corners(box_b)

    inter_w = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    inter_h = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = inter_w * inter_h
    if inter <= 0:
        return 0.0

    union = box_a["area"] + box_b["area"] - inter
    return inter / union if union > 0 else 0.0


def should_drop_small_box(box: dict[str, float]) -> bool:
    if box["class_id"] in {0, 3} and box["area"] < 0.00012:
        return True
    if box["class_id"] == 1 and box["area"] < 0.00005:
        return True
    if box["class_id"] == 2 and box["area"] < 0.0002:
        return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean generated YOLO labels by removing tiny or duplicate boxes.")
    parser.add_argument("--labels-dir", type=Path, required=True, help="Directory containing YOLO txt labels.")
    args = parser.parse_args()

    if not args.labels_dir.exists():
        raise FileNotFoundError(f"Labels directory not found: {args.labels_dir}")

    updated_files = 0
    removed_boxes = 0

    for label_path in sorted(args.labels_dir.glob("*.txt")):
        boxes = []
        for line in label_path.read_text(encoding="utf-8").splitlines():
            parsed = parse_label_line(line)
            if parsed and not should_drop_small_box(parsed):
                boxes.append(parsed)
            elif parsed:
                removed_boxes += 1

        kept: list[dict[str, float]] = []
        for box in sorted(boxes, key=lambda item: item["area"], reverse=True):
            duplicate = False
            for existing in kept:
                same_class = box["class_id"] == existing["class_id"]
                conflicting_car_truck = {box["class_id"], existing["class_id"]} == {0, 3}
                if (same_class or conflicting_car_truck) and iou(box, existing) > 0.75:
                    duplicate = True
                    removed_boxes += 1
                    break
            if not duplicate:
                kept.append(box)

        output = "\n".join(
            f"{box['class_id']} {box['x_center']:.6f} {box['y_center']:.6f} {box['width']:.6f} {box['height']:.6f}"
            for box in kept
        )
        if output:
            output += "\n"
        label_path.write_text(output, encoding="utf-8")
        updated_files += 1

    print(f"Updated {updated_files} label files.")
    print(f"Removed {removed_boxes} noisy boxes.")


if __name__ == "__main__":
    main()
