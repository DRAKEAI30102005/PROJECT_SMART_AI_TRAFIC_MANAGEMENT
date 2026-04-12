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


API_BASE_URL = os.environ.get("API_BASE_URL", "").rstrip("/")
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
TASK_NAME = os.environ.get("TASK_NAME", "openenv-benchmark")
BENCHMARK = os.environ.get("BENCHMARK", "benchmark")

def emit(line: str) -> None:
    print(line, flush=True)


def log_start(task: str, env: str, model: str) -> None:
    emit(f"[START] task={task} env={env} model={model}")


def log_step(step: int, action: str, reward: float, done: bool, error: str | None) -> None:
    error_val = error if error else "null"
    emit(
        f"[STEP] step={step} action={action} reward={reward:.2f} done={str(done).lower()} error={error_val}"
    )


def log_end(success: bool, steps: int, score: float, rewards: list[float], error: str | None = None) -> None:
    rewards_str = ",".join(f"{reward:.2f}" for reward in rewards)
    suffix = f" error={error}" if error else ""
    emit(f"[END] success={str(success).lower()} steps={steps} score={score:.3f} rewards={rewards_str}{suffix}")


def resolve_llm_config() -> tuple[str, str]:
    base_url = os.environ["API_BASE_URL"].strip().rstrip("/")
    api_key = os.environ["API_KEY"].strip()

    if not base_url:
        raise RuntimeError("Missing API_BASE_URL. Submission must use the injected LiteLLM/OpenAI-compatible proxy.")

    if not api_key:
        raise RuntimeError("Missing API_KEY. Submission must use the injected proxy API key.")

    if "api.openai.com" in base_url.lower():
        raise RuntimeError(
            "API_BASE_URL points to api.openai.com. Submission must use the injected LiteLLM/OpenAI-compatible proxy."
        )

    return base_url, api_key


def build_client() -> OpenAI | None:
    if OpenAI is None:
        raise RuntimeError("OpenAI client is not available in this environment.")
    base_url, api_key = resolve_llm_config()
    client = OpenAI(
        base_url=base_url,
        api_key=api_key,
    )
    warmup_llm_proxy(client)
    return client


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


def warmup_llm_proxy(client: OpenAI) -> None:
    client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "user",
                "content": 'Reply with strict JSON only: {"selected_lane_id":0}',
            }
        ],
        response_format={"type": "json_object"},
        temperature=0,
        max_tokens=20,
    )


def llm_lane(client: OpenAI, state: dict[str, Any]) -> int:
    return llm_lane_via_client(client, state)


def choose_lane(client: OpenAI, state: dict[str, Any]) -> tuple[int, str]:
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
    session = requests.Session()
    rewards: list[float] = []
    step_count = 0
    final_score = 0.0

    try:
        log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

        try:
            client = build_client()
        except Exception:
            client = None

        benchmark_base_url = resolve_benchmark_base_url(session)
        tasks_payload = request_json(session, benchmark_base_url, "GET", "/tasks")
        tasks = tasks_payload.get("tasks", [])

        scores: list[dict[str, Any]] = []
        for index, task in enumerate(tasks, start=1):
            reset_state = request_json(session, benchmark_base_url, "POST", "/reset", {"task_id": task["id"]})
            state = request_json(session, benchmark_base_url, "GET", "/state")
            lane_id, policy = choose_lane(client, state)
            result = request_json(session, benchmark_base_url, "POST", "/step", {"selected_lane_id": lane_id})
            graded_score = grade_task(reset_state, lane_id)
            score = min(max(float(result.get("score", graded_score)), 0.01), 0.99)
            step_count = index
            rewards.append(score)
            error = result.get("error")
            error_text = "null" if error in (None, "", "null") else str(error).replace("\n", " ")
            done = "true" if index == len(tasks) else "false"

            scores.append(
                {
                    "task_id": task["id"],
                    "selected_lane_id": lane_id,
                    "score": round(score, 3),
                    "policy": policy,
                }
            )
            log_step(step=index, action=f"select_lane({lane_id})", reward=score, done=index == len(tasks), error=error_text)

        final_score = round(sum(item["score"] for item in scores) / max(1, len(scores)), 3)
        log_end(success=True, steps=step_count, score=final_score, rewards=rewards)
    except Exception as exc:
        log_end(
            success=False,
            steps=step_count,
            score=final_score,
            rewards=rewards,
            error=str(exc).replace(chr(10), " "),
        )
        return


if __name__ == "__main__":
    try:
        main()
    except BaseException as exc:  # pragma: no cover - final submission safety net
        log_end(success=False, steps=0, score=0.0, rewards=[], error=f"fatal: {str(exc).replace(chr(10), ' ')}")
