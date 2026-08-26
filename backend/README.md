# CodeFlow Backend (local Flask replacement for the Lambda)

Drop-in replacement for `LambdaFunction/main.py`. Same request/response shape
(`{ message, system_message }` in, `{ statusCode, headers, body }` out), so
the frontend only needed its endpoint URL changed (see `src/config/apiConfig.ts`).

Uses `qwen3.7-max` via the DashScope SDK against the workspace-specific MaaS
gateway (`dashscope.Generation.call` — `qwen3.7-max` is a text/reasoning
model, not multimodal, so `MultiModalConversation` isn't the right endpoint
for it on this gateway).

## Setup

```bash
cd backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

Credentials live in `.env` (already filled in, gitignored). `.env.example`
shows the required keys if you need to rotate them.

## Run

```bash
./venv/bin/python app.py
```

Serves on `http://127.0.0.1:5001`. `GET /health` for a liveness check,
`POST /api/resource` for the actual chat completion.
