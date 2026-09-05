# CodeFlow Backend (local Flask replacement for the Lambda)

The non-streaming endpoint replaces `LambdaFunction/main.py`. Same request/response shape
(`{ message, system_message }` in, `{ statusCode, headers, body }` out), so
the frontend uses it for evaluation and exercise uploads. Flowchart generation
and execution traces use the separate streaming endpoint below, so each
top-level JSON field can be rendered as it arrives (see
`src/config/apiConfig.ts`).

Calls the LLM through [AgentScope](https://github.com/agentscope-ai/agentscope)'s
model abstraction rather than a provider SDK directly, so switching providers
is a matter of swapping the `build_model()` branch in `app.py` (keyed by the
`MODEL_PROVIDER` env var) rather than rewriting the call site. Currently
configured for `qwen3.7-max` via `DashScopeChatModel`, talking to the
workspace-specific MaaS gateway's OpenAI-compatible endpoint
(`.../compatible-mode/v1`).

The backend also exposes an error-tolerant Tree-sitter analysis endpoint used to
ground flowchart generation. It extracts source-positioned Java/Python control,
process, terminal, nesting, and syntax-recovery facts without executing student
code. Clean parses constrain student graphs through source anchors. Recovered
parses instead ask the model to infer flow from the original source without
parser structure constraints, with optional missing-symbol suggestions.

## Setup

Python 3.10 or newer is required by the bundled Tree-sitter Python grammar.

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

This command is for local development. Public deployment uses Gunicorn with
`gunicorn -c gunicorn.conf.py app:app`; see the repository's `DEPLOYMENT.md`.

Serves on `http://127.0.0.1:5001`:

- `GET /health` — liveness check
- `POST /api/resource` — chat completion using the existing Lambda-shaped envelope
- `POST /api/resource/stream` — streaming completion with the same input fields,
  returning newline-delimited JSON rather than a Lambda envelope
- `POST /api/analyze-code` — deterministic Tree-sitter facts from
  `{ "language": "java" | "python", "code": "..." }`

## Streaming protocol

The stream sends `start`, text `delta` frames (`text` field), and `done` with
model/usage metadata. An upstream failure sends `error` with a generic `message`
instead of `done`. Silent periods emit `ping` every 10 seconds, with a 180-second
generation deadline. Clients must not treat EOF alone as successful completion.

Each request owns its streaming AgentScope model, async event loop, and HTTP
client. Text deltas are forwarded immediately; the SDK's final accumulated
snapshot is checked, not appended again. Reasoning/tool blocks are not forwarded.
Client disconnects close the upstream response when the WSGI server detects
them (heartbeats permit detection during silent periods). Provider transport
retries are disabled for streaming and non-streaming requests; the frontend
owns the small status-aware transport retry policy. Every request creates and
closes its model HTTP client on the same async event loop.

Reverse proxies must allow streaming and disable response buffering/compression
that batches chunks. The response sets `X-Accel-Buffering: no` and
`Cache-Control: no-cache, no-transform`; proxy read timeouts must allow the stream
to complete. Production WSGI deployments need enough concurrent workers/threads
for evaluation and open streams. The legacy Lambda alone does not implement
this endpoint.

Run local tests without any live model calls:

```bash
./venv/bin/python -m unittest discover -s tests
```
