---
title: SmartFlow AI
emoji: 🚦
colorFrom: blue
colorTo: cyan
sdk: docker
app_port: 7860
pinned: false
---

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

## Submission-ready additions

- Benchmark endpoints: `POST /reset`, `GET /state`, `POST /step`, `GET /tasks`, `GET /health`
- Legacy detector endpoints preserved: `GET /api/health`, `GET /api/detections`
- Submission files included: `inference.py`, `validator.py`, `openapi.yaml`, `openenvy.yaml`, `Dockerfile`
- Task pack included in `bench/tasks.json` with graders in `bench/graders.py`

## Run Locally

**Prerequisites:** Node.js, Python 3.11+


1. Install dependencies:
   `npm install`
2. Install Python dependencies:
   `pip install -r ml/requirements.txt`
3. Copy `.env.example` to `.env.local` or set the environment variables directly
4. Run the app:
   `npm run dev`
5. Run the submission validator:
   `python validator.py`

## Submission environment variables

- `API_BASE_URL`: OpenAI-compatible LLM endpoint used by `inference.py`
- `MODEL_NAME`: model name for the OpenAI-compatible client
- `HF_TOKEN`: Hugging Face / API token used as the OpenAI-compatible API key
- `BENCHMARK_BASE_URL`: optional benchmark app URL, defaults to `http://127.0.0.1:3001`

`inference.py` will still complete with a deterministic fallback policy if the LLM is unavailable, which keeps local smoke tests reproducible.
