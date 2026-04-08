from __future__ import annotations

import os
from typing import Any

import requests
from fastapi import FastAPI, HTTPException


BENCHMARK_BASE_URL = os.environ.get("BENCHMARK_BASE_URL", "http://127.0.0.1:3001").rstrip("/")

app = FastAPI(
    title="SmartFlow AI OpenEnv Compatibility Server",
    description="Python compatibility shim that mirrors the benchmark routes exposed by the main Node service.",
    version="1.0.0",
)


def _proxy(method: str, endpoint: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        response = requests.request(method, f"{BENCHMARK_BASE_URL}{endpoint}", json=payload, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Upstream benchmark service unavailable: {exc}") from exc


@app.get("/health")
def health() -> dict[str, Any]:
    return _proxy("GET", "/health")


@app.get("/tasks")
def tasks() -> dict[str, Any]:
    return _proxy("GET", "/tasks")


@app.post("/reset")
def reset(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    return _proxy("POST", "/reset", payload or {})


@app.get("/state")
def state() -> dict[str, Any]:
    return _proxy("GET", "/state")


@app.post("/step")
def step(payload: dict[str, Any]) -> dict[str, Any]:
    return _proxy("POST", "/step", payload)


def server() -> FastAPI:
    return app
