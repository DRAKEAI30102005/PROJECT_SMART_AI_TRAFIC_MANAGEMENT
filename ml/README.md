# YOLO Training Workspace

This folder contains a practical training pipeline for a custom YOLO detector that recognizes:

- `car`
- `motorcycle`
- `bus`
- `truck`
- `ambulance`

## Important limitation

No computer vision model can guarantee zero mistakes on every real-world frame. The way to get the best result is to improve the dataset, labels, validation split, and retraining cycle.

## 1. Put the videos in place

Your four footage files should already be in:

- `public/videos/video1.mp4`
- `public/videos/video2.mp4`
- `public/videos/video3.mp4`
- `public/videos/video4.mp4`

## 2. Create and activate a Python environment

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r ml\requirements.txt
```

## 3. Extract frames from the videos

```powershell
python ml\scripts\extract_frames.py --video-dir public\videos --output-dir ml\datasets\traffic_vehicles\images\raw --frames-per-video 300
```

This creates evenly sampled frames from each video.

## 4. Bootstrap labels for common vehicle classes

```powershell
python ml\scripts\auto_label_frames.py --source ml\datasets\traffic_vehicles\images\raw --images-out ml\datasets\traffic_vehicles\images\staging --labels-out ml\datasets\traffic_vehicles\labels\staging --model yolov8m.pt --conf 0.35
```

This creates reviewable pseudo-labels for:

- `car`
- `motorcycle`
- `bus`
- `truck`

You still need to manually correct those labels and add all `ambulance` boxes as class `4`.

## 5. Annotate and correct the images

Label the frames in a tool such as CVAT, Roboflow, or Label Studio using these exact class names and IDs:

```text
0 car
1 motorcycle
2 bus
3 truck
4 ambulance
```

Expected dataset structure:

```text
ml/
  datasets/
    traffic_vehicles/
      images/
        train/
        val/
      labels/
        train/
        val/
      dataset.yaml
```

After reviewing the labels, split them into train and validation sets:

```powershell
python ml\scripts\split_dataset.py --images ml\datasets\traffic_vehicles\images\staging --labels ml\datasets\traffic_vehicles\labels\staging --dataset-root ml\datasets\traffic_vehicles --val-ratio 0.2
```

## 6. Train YOLO

```powershell
python ml\scripts\train_yolo.py --data ml\datasets\traffic_vehicles\dataset.yaml --model yolov8m.pt --epochs 100 --imgsz 1280 --batch 8
```

Recommended starting models:

- `yolov8n.pt` for faster experiments
- `yolov8m.pt` for a stronger balance of speed and accuracy
- `yolov8l.pt` if you have a strong GPU and want higher capacity

For higher accuracy on your footage, I recommend starting with `yolov8m.pt` or `yolov8l.pt` and keeping the training config at [ml/configs/yolo_high_accuracy.yaml](C:/Users/Aritra%20Ghosh/Desktop/scalar%20hacathon/ml/configs/yolo_high_accuracy.yaml).

## 7. Run inference on a new video

```powershell
python ml\scripts\run_inference.py --weights ml\runs\detect\traffic_vehicles\weights\best.pt --source public\videos\video1.mp4
```

## Quality checklist

- Label all visible target objects in each image.
- Include day, night, rain, glare, shadow, and blur cases if they appear in real traffic.
- Add enough ambulance examples so the class is not rare compared to cars.
- Keep validation footage different from training footage.
- Review false positives and hard misses after each training cycle.
