from __future__ import annotations

import json
from pathlib import Path
from typing import Any


TASKS_PATH = Path(__file__).resolve().parent / "tasks.json"
MIN_SCORE = 0.01
MAX_SCORE = 0.99


def load_tasks() -> list[dict[str, Any]]:
    return json.loads(TASKS_PATH.read_text(encoding="utf-8"))


def clamp_score(score: float) -> float:
    return round(min(MAX_SCORE, max(MIN_SCORE, score)), 3)


def expected_lane_from_state(state: dict[str, Any]) -> int:
    if state.get("evaluation") == "emergency" and state.get("emergency_lane_id") is not None:
        return int(state["emergency_lane_id"])

    lanes = sorted(
        state.get("lanes", []),
        key=lambda item: (-int(item.get("detected_count", 0)), int(item.get("lane_id", 0))),
    )
    return int(lanes[0]["lane_id"]) if lanes else 0


def grade_task(state: dict[str, Any], selected_lane_id: int) -> float:
    expected_lane = expected_lane_from_state(state)
    lanes = state.get("lanes", [])
    by_id = {int(lane["lane_id"]): lane for lane in lanes}
    best_lane = by_id.get(expected_lane)
    chosen = by_id.get(int(selected_lane_id))

    if not chosen or not best_lane:
        return MIN_SCORE

    if int(selected_lane_id) == expected_lane:
        return MAX_SCORE

    if state.get("evaluation") == "emergency":
        return 0.2 if int(chosen.get("detected_count", 0)) > 0 else MIN_SCORE

    best_count = max(1, int(best_lane.get("detected_count", 0)))
    chosen_count = int(chosen.get("detected_count", 0))
    return clamp_score(0.15 + (chosen_count / best_count) * 0.7)
