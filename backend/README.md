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

## Database

Postgres, reached through SQLAlchemy (`db.py`) with schema changes managed by
Alembic (`migrations/`). Models belong in `models.py`, or in a module imported
from it — `migrations/env.py` imports that module so `--autogenerate` sees the
whole schema, and a table missing from `Base.metadata` is silently absent from
generated migrations.

The engine is created lazily, so `DATABASE_URL` is only required once a
database-backed feature is used. `/health`, `/api/resource`, and
`/api/analyze-code` still run without it, and the test suite makes no database
connection.

Point `DATABASE_URL` at any Postgres instance you can reach; the URL's
`postgresql://` scheme is rewritten to `postgresql+psycopg://` in `db.py`, so
Render's connection string works verbatim.

```bash
./venv/bin/alembic revision --autogenerate -m "add users"
./venv/bin/alembic upgrade head
```

Render applies migrations through `preDeployCommand` on each deploy. Do not
call `Base.metadata.create_all()` at import time — the Gunicorn workers start
concurrently and would race.

### Connection pool

`db.py` bounds the pool per worker process because Gunicorn runs
`WEB_CONCURRENCY` processes with `GUNICORN_THREADS` threads each, and a pool
that grew per thread would exhaust the 100 connections a Basic Postgres
instance allows. Keep

    WEB_CONCURRENCY * (DB_POOL_SIZE + DB_MAX_OVERFLOW)

comfortably below that limit; the defaults are `2 * (5 + 5) = 20`. Requests
spend nearly all their time streaming from the model provider rather than
holding a connection, so a small pool is not the bottleneck. Connections use
`pool_pre_ping` and a 300-second recycle, since Render restarts instances for
maintenance and drops idle server connections.

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
