# CodeFlow deployment on Render

CodeFlow stays as two small services:

- `codeflow-frontend`: a Render Static Site built from `frontend/dist`.
- `codeflow-backend`: the Flask application served by Gunicorn.

The repository-root `render.yaml` creates both services from the `main`
branch. Flask's development server and Vite's development/preview server are
not exposed publicly.

## First deployment

1. Push the `main` branch to the Git provider connected to Render.
2. In Render, choose **New > Blueprint**, select this repository, and use the
   root-level `render.yaml`.
3. Enter `API_KEY`, `BASE_URL`, `MODEL`, `PROVIDER`, and `RESEARCH_PASSWORD`
   when Render asks for the backend configuration. `BASE_URL` is the provider's
   complete API endpoint; the server does not construct it from a workspace ID.
   Set the password in the dashboard
   only — this repository is public, so a value committed to `render.yaml` or
   the source would be permanently searchable and could not be rotated without
   a commit. Leaving it unset is a supported configuration: research mode
   disappears from the settings panel and the deployment becomes
   bring-your-own-key only.
4. Let Render create the backend and copy its public HTTPS URL.
5. Set the frontend service's `VITE_API_BASE_URL` to that URL, with no trailing
   slash (for example, `https://codeflow-backend.onrender.com`). Redeploy the
   frontend so Vite includes the value in its static build.
6. Open the frontend URL and verify upload, Run, flowchart streaming, trace, and
   Clear. The backend health check is available at `/health`.

Render supplies HTTPS for both public URLs. The backend intentionally keeps its
current public CORS behavior until the planned login/BYOK work is requested.

## Request timing and concurrency

Flowchart and trace streams stop after 180 seconds. The browser allows a little
over 200 seconds for the complete stream, and Gunicorn allows 240 seconds before
terminating a worker request. This prevents the web server from killing a valid
stream before the application can return a useful error.

Gunicorn defaults here to 2 workers with 50 threads each. These requests spend
most of their time waiting on the model provider, so threads are a simple fit
for this proof of concept. This is not a distributed queue or a promise that one
small Render instance can complete 100 student runs at exactly the same moment.
Run a rehearsal with realistic model latency and raise the Render instance size
or the two Gunicorn settings if requests queue or memory usage becomes high.

## Who may spend the study's quota

The intended behaviour is now in place: students who enter the study password
use the server-funded model, and everyone else supplies their own provider
credentials. The password is checked on the server, so the public API cannot be
called directly to bypass the panel in the browser.

The password is a shared secret. Once handed to a cohort it can be forwarded,
and nothing here prevents that — no rate limiting or per-participant quota was
requested, so a study-wide spending cap still has to be set at the provider,
not in this application. Rotating the password means changing
`RESEARCH_PASSWORD` in the Render dashboard; students then re-enter it once.

A student's own API key passes through the backend to their provider. It is
never logged or stored server-side, and the browser holds it only in memory
until the tab is reloaded.

## Future work deliberately not enabled

Per-participant quotas, rate limiting, and a study-wide spending cap remain
unimplemented. Named accounts (as opposed to one shared password) are also out
of scope.
