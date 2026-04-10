from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - submission env fallback
    OpenAI = None  # type: ignore[assignment]

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "bench"))

from graders import grade_task  # noqa: E402


API_BASE_URL = os.environ.get("API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
MODEL_NAME = os.environ.get("MODEL_NAME", os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"))
BENCHMARK_BASE_URL = os.environ.get("BENCHMARK_BASE_URL", "http://127.0.0.1:3001").rstrip("/")
BENCHMARK_FALLBACK_URLS = [
    BENCHMARK_BASE_URL,
    "http://127.0.0.1:7860",
    "http://localhost:7860",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
]
REQUEST_TIMEOUT_SECONDS = 30
REQUEST_RETRIES = 5
BENCHMARK_READY_WAIT_SECONDS = 90


def emit(tag: str, payload: dict[str, Any]) -> None:
    print(f"[{tag}] {json.dumps(payload, separators=(',', ':'))}")
    sys.stdout.flush()


def build_client() -> OpenAI | None:
    if OpenAI is None:
        return None
    try:
        return OpenAI(
            base_url=os.environ["API_BASE_URL"].rstrip("/"),
            api_key=os.environ["API_KEY"],
        )
    except KeyError:
        return None
    except Exception:
        return None


def deterministic_lane(state: dict[str, Any]) -> int:
    if state.get("evaluation") == "emergency" and state.get("emergency_lane_id") is not None:
        return int(state["emergency_lane_id"])

    lanes = sorted(
        state.get("lanes", []),
        key=lambda lane: (-int(lane.get("detected_count", 0)), int(lane.get("lane_id", 0))),
    )
    return int(lanes[0]["lane_id"]) if lanes else 0


def llm_payload(state: dict[str, Any]) -> dict[str, Any]:
    return {
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


def llm_messages(state: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": "You are a traffic-signal controller. Choose the best next lane. If any lane is an emergency lane, prioritize it. Reply with strict JSON only.",
        },
        {"role": "user", "content": json.dumps(llm_payload(state))},
    ]


def parse_selected_lane_id(content: str) -> int:
    payload = json.loads(content or "{}")
    return int(payload["selected_lane_id"])


def llm_lane_via_client(client: OpenAI, state: dict[str, Any]) -> int:
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=llm_messages(state),
        response_format={"type": "json_object"},
        temperature=0,
    )
    return parse_selected_lane_id(response.choices[0].message.content or "{}")


def llm_lane(client: OpenAI | None, state: dict[str, Any]) -> int:
    if client is None:
        raise RuntimeError("Missing OpenAI client configuration.")
    return llm_lane_via_client(client, state)


def choose_lane(client: OpenAI | None, state: dict[str, Any]) -> tuple[int, str]:
    if client is None:
        return deterministic_lane(state), "deterministic-fallback"

    try:
        return llm_lane(client, state), "openai-client"
    except Exception:
        return deterministic_lane(state), "deterministic-fallback"


def benchmark_candidates() -> list[str]:
    seen: set[str] = set()
    candidates: list[str] = []
    for base_url in BENCHMARK_FALLBACK_URLS:
        normalized = base_url.rstrip("/")
        if normalized and normalized not in seen:
            seen.add(normalized)
            candidates.append(normalized)
    return candidates


def resolve_benchmark_base_url(session: requests.Session) -> str:
    started_at = time.monotonic()
    last_error: Exception | None = None

    while time.monotonic() - started_at < BENCHMARK_READY_WAIT_SECONDS:
        for candidate in benchmark_candidates():
            try:
                health = session.get(f"{candidate}/health", timeout=10)
                health.raise_for_status()
                tasks = session.get(f"{candidate}/tasks", timeout=10)
                tasks.raise_for_status()
                return candidate
            except requests.RequestException as exc:
                last_error = exc

        time.sleep(2)

    if last_error is not None:
        raise RuntimeError(f"Benchmark endpoint was not reachable: {last_error}") from last_error
    raise RuntimeError("Benchmark endpoint was not reachable.")


def request_json(
    session: requests.Session,
    benchmark_base_url: str,
    method: str,
    endpoint: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    last_error: Exception | None = None

    for attempt in range(REQUEST_RETRIES):
        try:
            response = session.request(
                method,
                f"{benchmark_base_url}{endpoint}",
                json=payload,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_error = exc
            if attempt < REQUEST_RETRIES - 1:
                time.sleep(min(1.5 * (attempt + 1), 5))

    raise RuntimeError(f"Request failed for {endpoint}: {last_error}") from last_error


def main() -> None:
    client = build_client()
    session = requests.Session()

    try:
        benchmark_base_url = resolve_benchmark_base_url(session)
        tasks_payload = request_json(session, benchmark_base_url, "GET", "/tasks")
        tasks = tasks_payload.get("tasks", [])

        emit(
            "START",
            {
                "task_count": len(tasks),
                "benchmark_base_url": benchmark_base_url,
                "api_base_url": API_BASE_URL,
                "model_name": MODEL_NAME or "deterministic-fallback",
            },
        )

        scores: list[dict[str, Any]] = []
        for index, task in enumerate(tasks, start=1):
            reset_state = request_json(session, benchmark_base_url, "POST", "/reset", {"task_id": task["id"]})
            state = request_json(session, benchmark_base_url, "GET", "/state")
            lane_id, policy = choose_lane(client, state)
            result = request_json(session, benchmark_base_url, "POST", "/step", {"selected_lane_id": lane_id})
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
    except Exception as exc:
        emit(
            "END",
            {
                "average_score": 0.0,
                "scores": [],
                "error": str(exc),
            },
        )


if __name__ == "__main__":
    try:
        main()
    except BaseException as exc:  # pragma: no cover - final submission safety net
        emit(
            "END",
            {
                "average_score": 0.0,
                "scores": [],
                "error": f"fatal: {exc}",
            },
        )
