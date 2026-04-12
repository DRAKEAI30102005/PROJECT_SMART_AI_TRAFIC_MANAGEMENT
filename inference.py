"""
Inference Script Example
===================================
MANDATORY
- Before submitting, ensure the following variables are defined in your environment configuration:
    API_BASE_URL   The API endpoint for the LLM.
    MODEL_NAME     The model identifier to use for inference.
    HF_TOKEN       Your Hugging Face / API key.
    LOCAL_IMAGE_NAME The name of the local image to use for the environment if you are using from_docker_image()
                     method

- Defaults are set only for API_BASE_URL and MODEL_NAME
    (and should reflect your active inference setup):
    API_BASE_URL = os.getenv("API_BASE_URL", "<your-active-endpoint>")
    MODEL_NAME = os.getenv("MODEL_NAME", "<your-active-model>")

- The inference script must be named `inference.py` and placed in the root directory of the project
- Participants must use OpenAI Client for all LLM calls using above variables

STDOUT FORMAT
- The script must emit exactly three line types to stdout, in this order:

    [START] task=<task_name> env=<benchmark> model=<model_name>
    [STEP]  step=<n> action=<action_str> reward=<0.00> done=<true|false> error=<msg|null>
    [END]   success=<true|false> steps=<n> score=<score> rewards=<r1,r2,...,rn>

  Rules:
    - One [START] line at episode begin.
    - One [STEP] line per step, immediately after env.step() returns.
    - One [END] line after env.close(), always emitted (even on exception).
    - reward and rewards are formatted to 2 decimal places.
    - done and success are lowercase booleans: true or false.
    - error is the raw last_action_error string, or null if none.
    - All fields on a single line with no newlines within a line.
    - Each tasks should return score in [0, 1]
"""

from __future__ import annotations

import json
import os
import sys
import textwrap
import time
from pathlib import Path
from typing import Any, List, Optional

import requests
from openai import OpenAI

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "bench"))

from graders import grade_task  # noqa: E402


def load_local_env(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env(ROOT / ".env")

IMAGE_NAME = os.getenv("IMAGE_NAME")  # If you are using docker image
API_KEY = os.getenv("HF_TOKEN") or os.getenv("API_KEY")

API_BASE_URL = os.getenv("API_BASE_URL") or "https://router.huggingface.co/v1"
MODEL_NAME = os.getenv("MODEL_NAME") or "Qwen/Qwen2.5-72B-Instruct"
TASK_NAME = os.getenv("TASK_NAME", "openenv-benchmark")
BENCHMARK = os.getenv("BENCHMARK", "benchmark")
BENCHMARK_BASE_URL = os.getenv("BENCHMARK_BASE_URL", "http://127.0.0.1:3001").rstrip("/")
MAX_STEPS = 8
TEMPERATURE = 0.7
MAX_TOKENS = 150
SUCCESS_SCORE_THRESHOLD = 0.1
REQUEST_TIMEOUT_SECONDS = 30
REQUEST_RETRIES = 5
BENCHMARK_READY_WAIT_SECONDS = 90

BENCHMARK_FALLBACK_URLS = [
    BENCHMARK_BASE_URL,
    "http://127.0.0.1:7860",
    "http://localhost:7860",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
]

SYSTEM_PROMPT = textwrap.dedent(
    """
    You are a traffic signal controller. Choose the best lane for the next green phase.
    If any lane is marked as an emergency lane, prioritize it immediately.
    Reply with strict JSON only in the format {"selected_lane_id": <integer>}.
    """
).strip()


def log_start(task: str, env: str, model: str) -> None:
    print(f"[START] task={task} env={env} model={model}", flush=True)


def log_step(step: int, action: str, reward: float, done: bool, error: Optional[str]) -> None:
    error_val = error if error else "null"
    done_val = str(done).lower()
    print(
        f"[STEP] step={step} action={action} reward={reward:.2f} done={done_val} error={error_val}",
        flush=True,
    )


def log_end(success: bool, steps: int, score: float, rewards: List[float]) -> None:
    rewards_str = ",".join(f"{r:.2f}" for r in rewards)
    print(f"[END] success={str(success).lower()} steps={steps} score={score:.3f} rewards={rewards_str}", flush=True)


def build_client() -> OpenAI:
    if not API_KEY:
        raise RuntimeError("Missing API_KEY.")
    if not API_BASE_URL:
        raise RuntimeError("Missing API_BASE_URL.")
    return OpenAI(base_url=API_BASE_URL, api_key=API_KEY)


def deterministic_lane(state: dict[str, Any]) -> int:
    if state.get("evaluation") == "emergency" and state.get("emergency_lane_id") is not None:
        return int(state["emergency_lane_id"])

    lanes = sorted(
        state.get("lanes", []),
        key=lambda lane: (-int(lane.get("detected_count", 0)), int(lane.get("lane_id", 0))),
    )
    return int(lanes[0]["lane_id"]) if lanes else 0


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


def build_user_prompt(state: dict[str, Any], history: List[str]) -> str:
    history_block = "\n".join(history[-4:]) if history else "None"
    lane_block = json.dumps(
        {
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
        }
    )
    return textwrap.dedent(
        f"""
        Current benchmark state:
        {lane_block}

        Previous steps:
        {history_block}

        Return strict JSON only with one integer field: {{"selected_lane_id": <integer>}}
        """
    ).strip()


def parse_selected_lane_id(content: str) -> int:
    payload = json.loads(content or "{}")
    return int(payload["selected_lane_id"])


def get_model_message(client: OpenAI, state: dict[str, Any], history: List[str]) -> int:
    user_prompt = build_user_prompt(state, history)
    completion = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=TEMPERATURE,
        max_tokens=MAX_TOKENS,
        response_format={"type": "json_object"},
        stream=False,
    )
    text = (completion.choices[0].message.content or "").strip()
    return parse_selected_lane_id(text)


def main() -> None:
    session: requests.Session | None = None
    history: List[str] = []
    rewards: List[float] = []
    steps_taken = 0
    score = 0.0
    success = False

    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    try:
        client = build_client()
        session = requests.Session()
        benchmark_base_url = resolve_benchmark_base_url(session)
        tasks_payload = request_json(session, benchmark_base_url, "GET", "/tasks")
        tasks = tasks_payload.get("tasks", [])

        for step, task in enumerate(tasks[:MAX_STEPS], start=1):
            reset_state = request_json(session, benchmark_base_url, "POST", "/reset", {"task_id": task["id"]})
            state = request_json(session, benchmark_base_url, "GET", "/state")

            try:
                lane_id = get_model_message(client, state, history)
            except Exception:
                lane_id = deterministic_lane(state)

            result = request_json(session, benchmark_base_url, "POST", "/step", {"selected_lane_id": lane_id})
            reward = min(max(float(result.get("score", grade_task(reset_state, lane_id))), 0.01), 0.99)
            done = bool(result.get("done", True))
            error = result.get("error")

            rewards.append(reward)
            steps_taken = step
            log_step(step=step, action=f"select_lane({lane_id})", reward=reward, done=done, error=error)
            history.append(f"Step {step}: selected_lane_id={lane_id} -> reward {reward:.2f}")

        score = min(max(sum(rewards) / max(1, len(rewards)), 0.01), 0.99)
        success = score >= SUCCESS_SCORE_THRESHOLD
    except BaseException:
        success = False
    finally:
        if session is not None:
            session.close()
        log_end(success=success, steps=steps_taken, score=score, rewards=rewards)


if __name__ == "__main__":
    main()
