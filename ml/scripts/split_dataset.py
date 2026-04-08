from __future__ import annotations

import argparse
import random
import shutil
from pathlib import Path


def paired_label_path(labels_dir: Path, image_path: Path) -> Path:
    return labels_dir / f"{image_path.stem}.txt"


def copy_pair(image_path: Path, source_labels_dir: Path, image_dest: Path, label_dest: Path) -> None:
    label_path = paired_label_path(source_labels_dir, image_path)
    if not label_path.exists():
        return

    image_dest.mkdir(parents=True, exist_ok=True)
    label_dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(image_path, image_dest / image_path.name)
    shutil.copy2(label_path, label_dest / label_path.name)


def main() -> None:
    parser = argparse.ArgumentParser(description="Split labeled YOLO images into train/val folders.")
    parser.add_argument("--images", type=Path, required=True, help="Source image folder.")
    parser.add_argument("--labels", type=Path, required=True, help="Source label folder.")
    parser.add_argument("--dataset-root", type=Path, required=True, help="Dataset root folder.")
    parser.add_argument("--val-ratio", type=float, default=0.2, help="Validation split ratio.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed.")
    args = parser.parse_args()

    image_paths = sorted(
        [path for path in args.images.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png"}]
    )
    if not image_paths:
        raise FileNotFoundError(f"No images found in {args.images}")

    paired_images = [path for path in image_paths if paired_label_path(args.labels, path).exists()]
    if not paired_images:
        raise FileNotFoundError("No image/label pairs found to split.")

    random.seed(args.seed)
    random.shuffle(paired_images)

    split_index = max(1, int(len(paired_images) * (1 - args.val_ratio)))
    train_images = paired_images[:split_index]
    val_images = paired_images[split_index:]

    if not val_images:
        val_images = train_images[-1:]
        train_images = train_images[:-1]

    for image_path in train_images:
        copy_pair(
            image_path,
            args.labels,
            args.dataset_root / "images" / "train",
            args.dataset_root / "labels" / "train",
        )

    for image_path in val_images:
        copy_pair(
            image_path,
            args.labels,
            args.dataset_root / "images" / "val",
            args.dataset_root / "labels" / "val",
        )

    print(f"Train images: {len(train_images)}")
    print(f"Val images: {len(val_images)}")


if __name__ == "__main__":
    main()
