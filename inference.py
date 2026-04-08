from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import requests
from openai import OpenAI

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "bench"))

from graders import grade_task  # noqa: E402


API_BASE_URL = os.environ.get("API_BASE_URL", "http://127.0.0.1:3001").rstrip("/")
MODEL_NAME = os.environ.get("MODEL_NAME", "")
HF_TOKEN = os.environ.get("HF_TOKEN", "")
BENCHMARK_BASE_URL = os.environ.get("BENCHMARK_BASE_URL", "http://127.0.0.1:3001").rstrip("/")


def emit(tag: str, payload: dict[str, Any]) -> None:
    print(f"[{tag}] {json.dumps(payload, separators=(',', ':'))}")
    sys.stdout.flush()


def build_client() -> OpenAI | None:
    if not API_BASE_URL or not MODEL_NAME or not HF_TOKEN:
        return None
    return OpenAI(base_url=API_BASE_URL, api_key=HF_TOKEN)


def deterministic_lane(state: dict[str, Any]) -> int:
    if state.get("evaluation") == "emergency" and state.get("emergency_lane_id") is not None:
        return int(state["emergency_lane_id"])

    lanes = sorted(
        state.get("lanes", []),
        key=lambda lane: (-int(lane.get("detected_count", 0)), int(lane.get("lane_id", 0))),
    )
    return int(lanes[0]["lane_id"]) if lanes else 0


def llm_lane(client: OpenAI, state: dict[str, Any]) -> int:
    prompt = {
        "task": state.get("title"),
        "description": state.get("description"),
        "evaluation": state.get("evaluation"),
        "emergency_lane_id": state.get("emergency_lane_id"),
        "lanes": [
            {
                "lane_id": lane["lane_id"],
                "name": lane["name"],
                "detected_count": lane["detected_count"],
                "has_ambulance": lane["has_ambulance"],
                "top_detections": lane["detections"],
            }
            for lane in state.get("lanes", [])
        ],
        "instruction": "Return JSON with a single integer field named selected_lane_id.",
    }

    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "system",
                "content": "You are a traffic-signal controller. Choose the best next lane. If any lane is an emergency lane, prioritize it. Reply with strict JSON only.",
            },
            {"role": "user", "content": json.dumps(prompt)},
        ],
        response_format={"type": "json_object"},
        temperature=0,
    )
    content = response.choices[0].message.content or "{}"
    payload = json.loads(content)
    return int(payload["selected_lane_id"])


def choose_lane(client: OpenAI | None, state: dict[str, Any]) -> tuple[int, str]:
    if client is None:
        return deterministic_lane(state), "deterministic-fallback"

    try:
        return llm_lane(client, state), "openai-client"
    except Exception:
        return deterministic_lane(state), "deterministic-fallback"


def request_json(method: str, endpoint: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    response = requests.request(method, f"{BENCHMARK_BASE_URL}{endpoint}", json=payload, timeout=120)
    response.raise_for_status()
    return response.json()


def main() -> None:
    client = build_client()
    tasks_payload = request_json("GET", "/tasks")
    tasks = tasks_payload.get("tasks", [])

    emit(
        "START",
        {
            "task_count": len(tasks),
            "benchmark_base_url": BENCHMARK_BASE_URL,
            "api_base_url": API_BASE_URL,
            "model_name": MODEL_NAME or "deterministic-fallback",
        },
    )

    scores: list[dict[str, Any]] = []
    for index, task in enumerate(tasks, start=1):
        reset_state = request_json("POST", "/reset", {"task_id": task["id"]})
        state = request_json("GET", "/state")
        lane_id, policy = choose_lane(client, state)
        result = request_json("POST", "/step", {"selected_lane_id": lane_id})
        graded_score = grade_task(reset_state, lane_id)
        score = min(max(float(result.get("score", graded_score)), 0.0), 1.0)

        scores.append(
            {
                "task_id": task["id"],
                "selected_lane_id": lane_id,
                "score": round(score, 3),
                "policy": policy,
            }
        )
        emit(
            "STEP",
            {
                "task_index": index,
                "task_id": task["id"],
                "selected_lane_id": lane_id,
                "expected_lane_id": result.get("expected_lane_id"),
                "reward": score,
                "policy": policy,
            },
        )

    average_score = round(sum(item["score"] for item in scores) / max(1, len(scores)), 3)
    emit("END", {"average_score": average_score, "scores": scores})


if __name__ == "__main__":
    main()
