# CodeFlow Backend (local Flask replacement for the Lambda)

Drop-in replacement for `LambdaFunction/main.py`. Same request/response shape
(`{ message, system_message }` in, `{ statusCode, headers, body }` out), so
the frontend only needed its endpoint URL changed (see `src/config/apiConfig.ts`).

Calls the LLM through [AgentScope](https://github.com/agentscope-ai/agentscope)'s
model abstraction rather than a provider SDK directly, so switching providers
is a matter of swapping the `build_model()` branch in `app.py` (keyed by the
`MODEL_PROVIDER` env var) rather than rewriting the call site. Currently
configured for `qwen3.7-max` via `DashScopeChatModel`, talking to the
workspace-specific MaaS gateway's OpenAI-compatible endpoint
(`.../compatible-mode/v1`).

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
