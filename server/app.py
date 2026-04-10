from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

from fastapi import Body, FastAPI, HTTPException
from pydantic import BaseModel


ROOT = Path(__file__).resolve().parents[1]
TASKS = json.loads((ROOT / "bench" / "tasks.json").read_text(encoding="utf-8"))
MIN_SCORE = 0.01
MAX_SCORE = 0.99


class LaneSnapshot(BaseModel):
    lane_id: int
    name: str
    video: str
    timestamp: float
    detected_count: int
    has_ambulance: bool
    detections: list[dict[str, Any]]


class BenchmarkState(BaseModel):
    task_id: str
    title: str
    description: str
    evaluation: Literal["density", "emergency"]
    emergency_lane_id: int | None
    expected_lane_id: int
    lanes: list[LaneSnapshot]
    done: bool
    step_count: int


app = FastAPI(
    title="SmartFlow AI OpenEnv Server",
    description="Standalone Python benchmark server used for OpenEnv submission validation.",
    version="1.0.0",
)
server = app
SESSION: BenchmarkState | None = None
TASK_INDEX = 0


def synthetic_count(video: str, timestamp: float, lane_id: int) -> int:
    seed = sum(ord(char) for char in video) + int(timestamp * 10) + lane_id * 7
    return 2 + (seed % 8)


def synthetic_detections(video: str, count: int, emergency_lane_id: int | None, lane_id: int) -> tuple[list[dict[str, Any]], bool]:
    labels = ["car", "motorcycle", "bus", "truck"]
    detections = [
        {
            "label": labels[index % len(labels)],
            "confidence": round(max(0.35, 0.88 - index * 0.08), 3),
        }
        for index in range(min(count, 5))
    ]

    has_ambulance = emergency_lane_id == lane_id or video.lower() == "video8.mp4"
    if has_ambulance:
        detections = [{"label": "ambulance", "confidence": 0.99}, *detections[:4]]
    return detections[:5], has_ambulance


def build_state(task: dict[str, Any]) -> BenchmarkState:
    lanes: list[LaneSnapshot] = []
    emergency_lane_id = task.get("emergency_lane_id")

    for lane in task["lanes"]:
        count = synthetic_count(lane["video"], float(lane["timestamp"]), int(lane["lane_id"]))
        detections, has_ambulance = synthetic_detections(
            lane["video"],
            count,
            emergency_lane_id if isinstance(emergency_lane_id, int) else None,
            int(lane["lane_id"]),
        )
        if isinstance(emergency_lane_id, int) and lane["lane_id"] == emergency_lane_id:
            count = max(count, 6)

        lanes.append(
            LaneSnapshot(
                lane_id=int(lane["lane_id"]),
                name=str(lane["name"]),
                video=str(lane["video"]),
                timestamp=float(lane["timestamp"]),
                detected_count=count,
                has_ambulance=has_ambulance,
                detections=detections,
            )
        )

    if isinstance(emergency_lane_id, int):
        expected_lane_id = emergency_lane_id
    else:
        expected_lane_id = max(lanes, key=lambda lane: (lane.detected_count, -lane.lane_id)).lane_id

    return BenchmarkState(
        task_id=str(task["id"]),
        title=str(task["title"]),
        description=str(task["description"]),
        evaluation=task["evaluation"],
        emergency_lane_id=emergency_lane_id if isinstance(emergency_lane_id, int) else None,
        expected_lane_id=expected_lane_id,
        lanes=lanes,
        done=False,
        step_count=0,
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "benchmark": True, "python_openenv": True}


@app.get("/tasks")
def tasks() -> dict[str, Any]:
    return {"tasks": TASKS}


@app.post("/reset")
def reset(payload: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    global SESSION, TASK_INDEX

    task_id = payload.get("task_id") if isinstance(payload, dict) else None
    task = next((item for item in TASKS if item["id"] == task_id), None)
    if task is None:
        task = TASKS[TASK_INDEX % len(TASKS)]
        TASK_INDEX = (TASK_INDEX + 1) % len(TASKS)

    SESSION = build_state(task)
    return SESSION.model_dump()


@app.get("/state")
def state() -> dict[str, Any]:
    if SESSION is None:
        raise HTTPException(status_code=404, detail="Call POST /reset before requesting /state.")
    return SESSION.model_dump()


@app.post("/step")
def step(payload: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    global SESSION
    if SESSION is None:
        raise HTTPException(status_code=404, detail="Call POST /reset before requesting /step.")

    payload = payload or {}
    selected_lane_id = payload.get("selected_lane_id", payload.get("lane_id", payload.get("action")))
    if not isinstance(selected_lane_id, int):
        raise HTTPException(status_code=400, detail="Provide an integer selected_lane_id.")

    expected_lane_id = SESSION.expected_lane_id
    reward = MAX_SCORE if selected_lane_id == expected_lane_id else 0.25
    SESSION = SESSION.model_copy(update={"done": True, "step_count": SESSION.step_count + 1})
    return {
        "task_id": SESSION.task_id,
        "selected_lane_id": selected_lane_id,
        "expected_lane_id": expected_lane_id,
        "reward": reward,
        "score": reward,
        "done": True,
        "reason": "Selected lane matches benchmark expectation." if reward == 1.0 else "Selected lane differs from benchmark expectation.",
    }


def main() -> None:
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
