from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import requests
import yaml

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "bench"))

from graders import grade_task, load_tasks  # noqa: E402


REQUIRED_FILES = [
    "Dockerfile",
    "inference.py",
    "pyproject.toml",
    "uv.lock",
    "validator.py",
    "openapi.yaml",
    "openenv.yaml",
    "openenvy.yaml",
    "bench/tasks.json",
    "bench/graders.py",
    "server/app.py",
]


def check_files() -> list[str]:
    missing = [file_path for file_path in REQUIRED_FILES if not (ROOT / file_path).exists()]
    return missing


def check_openapi() -> tuple[bool, str]:
    try:
        spec = yaml.safe_load((ROOT / "openapi.yaml").read_text(encoding="utf-8"))
    except Exception as exc:
        return False, f"openapi.yaml could not be parsed: {exc}"

    paths = spec.get("paths", {})
    required_paths = ["/health", "/tasks", "/reset", "/state", "/step"]
    missing_paths = [item for item in required_paths if item not in paths]
    if missing_paths:
        return False, f"Missing paths in OpenAPI spec: {', '.join(missing_paths)}"
    return True, "OpenAPI spec contains all required benchmark routes."


def check_tasks_and_graders() -> tuple[bool, str]:
    tasks = load_tasks()
    if len(tasks) < 3:
        return False, "At least 3 tasks are required."

    sample_state = {
        "evaluation": "density",
        "emergency_lane_id": None,
        "lanes": [
            {"lane_id": 0, "detected_count": 2},
            {"lane_id": 1, "detected_count": 5},
        ],
    }
    score = grade_task(sample_state, 1)
    if not 0 <= score <= 1:
        return False, "Grader output is not in the 0.0-1.0 range."
    return True, f"Loaded {len(tasks)} tasks and grader outputs a valid normalized score."


def check_live_api(api_base_url: str) -> tuple[bool, str]:
    try:
        health = requests.get(f"{api_base_url.rstrip('/')}/health", timeout=20)
        health.raise_for_status()
        tasks = requests.get(f"{api_base_url.rstrip('/')}/tasks", timeout=20)
        tasks.raise_for_status()
        return True, "Live benchmark API responded successfully."
    except Exception as exc:
        return False, f"Live API check skipped or failed: {exc}"


def maybe_run_inference(run_inference: bool) -> tuple[bool, str]:
    if not run_inference:
        return True, "Inference smoke run skipped."

    try:
        result = subprocess.run(
            [sys.executable, "inference.py"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=600,
        )
        last_line = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
        return True, f"Inference smoke run passed. Last log line: {last_line}"
    except Exception as exc:
        return False, f"Inference smoke run failed: {exc}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Pre-submission validator for SmartFlow AI.")
    parser.add_argument("--run-inference", action="store_true", help="Run inference.py after static checks.")
    args = parser.parse_args()

    api_base_url = os.environ.get("BENCHMARK_BASE_URL", "http://127.0.0.1:3001")

    report: list[dict[str, Any]] = []

    missing_files = check_files()
    report.append(
        {
            "name": "required_files",
            "passed": not missing_files,
            "details": "All required submission files exist." if not missing_files else f"Missing files: {', '.join(missing_files)}",
        }
    )

    openapi_ok, openapi_message = check_openapi()
    report.append({"name": "openapi", "passed": openapi_ok, "details": openapi_message})

    tasks_ok, tasks_message = check_tasks_and_graders()
    report.append({"name": "tasks_and_graders", "passed": tasks_ok, "details": tasks_message})

    api_ok, api_message = check_live_api(api_base_url)
    report.append({"name": "live_api", "passed": api_ok, "details": api_message})

    inference_ok, inference_message = maybe_run_inference(args.run_inference)
    report.append({"name": "inference", "passed": inference_ok, "details": inference_message})

    print(json.dumps(report, indent=2))
    if not all(item["passed"] for item in report if item["name"] != "live_api"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
