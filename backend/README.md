# CodeFlow Backend (local Flask replacement for the Lambda)

The non-streaming endpoint replaces `LambdaFunction/main.py`. Same request/response shape
(`{ message, system_message }` in, `{ statusCode, headers, body }` out), so
the frontend uses it for evaluation and exercise uploads. Flowchart generation
and execution traces use the separate streaming endpoint below, so each
top-level JSON field can be rendered as it arrives (see
`src/config/apiConfig.ts`).

Calls the LLM through [AgentScope](https://github.com/agentscope-ai/agentscope)'s
model abstraction rather than a provider SDK directly. Each request names the
provider it wants, and `model_config.py` turns that into a configured model:
AgentScope gives every provider the same constructor and lets a credential name
its own model class, so the provider list is data (`PROVIDERS`) rather than a
branch per provider. OpenAI, DashScope, Anthropic, and DeepSeek are offered; all
four take the same `api_key` plus optional `base_url`. Adding a provider whose
credential is shaped differently (Ollama uses `host`, xAI `api_host`, Gemini has
no base URL) would need a field mapping as well.

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
- `GET /api/providers` — the provider catalogue the settings panel renders, and
  whether this server has a research password configured
- `POST /api/verify-config` — check a `modelConfig` without spending a model call
- `POST /api/analyze-code` — deterministic Tree-sitter facts from
  `{ "language": "java" | "python", "code": "..." }`

## Request size

`MAX_CONTENT_LENGTH` caps a request body at 2 MB, and each LLM endpoint also
rejects a message plus system prompt longer than a million characters. A
generous real request — a long problem statement, parser facts, and both
rendered graphs — measures under 30 KB, so the cap cannot reach ordinary use.

The cap has to be set for the 413 handlers to run at all: without
`MAX_CONTENT_LENGTH`, Werkzeug never raises `RequestEntityTooLarge`, the
handlers are unreachable, and an arbitrarily large body is read into a worker's
memory. `RequestEntityTooLarge` is not a `BadRequest` subclass, so the stream
endpoint catches it separately rather than falling through to Flask's HTML
error page.

## Who may call the model

Every request to `/api/resource` and `/api/resource/stream` must carry a
`modelConfig` object, or it is refused with 401. There is no default: the
study's quota is never spent by an unidentified caller. `/api/analyze-code`
calls no model and stays open.

`modelConfig` is one of:

- `{ "password": "..." }` — research mode. Compared against `RESEARCH_PASSWORD`
  with `hmac.compare_digest`, and only on a match are the server's own DashScope
  credentials used. An unset `RESEARCH_PASSWORD` disables research mode rather
  than admitting everyone, so a missing environment variable cannot silently
  open the server's key to the public.
- `{ "provider", "model", "apiKey", "baseUrl"? }` — the caller's own
  credentials, used for that one request.

Checking the password in the browser would not be a control at all: the API is
public, so anyone could call it directly and spend the study's quota. The
browser check only provides fast feedback.

A caller-supplied `baseUrl` makes this server issue a request to an address the
caller chose, so `model_config.py` requires an http(s) URL and refuses hosts
resolving to loopback, private, link-local, reserved, or multicast addresses —
otherwise the public API doubles as a proxy for probing the deployment's own
network and cloud metadata endpoints. DNS is resolved at validation time, which
is a real barrier rather than an airtight one.

A caller's API key passes through this server on its way to their provider. It
is never logged and never stored, and `ModelSpec.__repr__` masks it so an
accidental log line or traceback cannot leak it.

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
