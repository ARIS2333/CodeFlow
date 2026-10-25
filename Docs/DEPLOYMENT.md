# CodeFlow deployment on Render

CodeFlow stays as two small services:

- `codeflow-frontend`: a Render Static Site built from `frontend/dist`.
- `codeflow-backend`: the Flask application served by Gunicorn.
- `codeflow-study-db`: the PostgreSQL database containing participant accounts,
  immutable Run Code submissions, and each participant's latest recoverable
  study workspace, plus per-model-call token usage and the $1.00 participant
  AI-feedback allowance.

The repository-root `render.yaml` creates both services from the `UF_1_toolEval`
branch. Flask's development server and Vite's development/preview server are
not exposed publicly.

## First deployment

1. Push the `UF_1_toolEval` branch to the Git provider connected to Render.
2. In Render, choose **New > Blueprint**, select this repository, and use the
   root-level `render.yaml`.
3. Confirm that the existing Render Postgres resource is named
   `codeflow-study-db`. The Blueprint links its internal connection URL to the
   backend as `DATABASE_URL`. Keep that database and environment variable; a
   second database is not needed. Before every Gunicorn start, the backend runs
   the idempotent `init_db.py` initializer. It creates or migrates the
   participant-account, submission, progress, per-question workspace, and LLM
   usage tables
   without clearing existing study data. The persistence layer also performs a
   concurrency-safe initialization on first use, so an existing Render service
   with an older Start Command can recover after the updated backend is
   deployed.
4. Enter `API_KEY`, `BASE_URL`, `MODEL`, and `PROVIDER`
   when Render asks for the backend configuration. `BASE_URL` is the provider's
   complete API endpoint; the server does not construct it from a workspace ID.
   These server-owned credentials fund feedback generation for registered study
   participants and must be configured only in the Render dashboard.
   Set `ENABLE_NATIVE_CPP_TRACE=true` when the deployed backend provides `g++`.
   The Blueprint supplies the native compile and run timeouts. If a native C++
   trace fails, the frontend automatically falls back to the configured model.
5. Let Render create the backend and copy its public HTTPS URL.
6. Set the frontend service's `VITE_API_BASE_URL` to that URL, with no trailing
   slash (for example, `https://codeflow-backend.onrender.com`). Redeploy the
   frontend so Vite includes the value in its static build.
7. Replace the placeholder Google Forms links in
   `frontend/src/config/studyConfig.ts` with the study's real survey URLs.
8. Open the frontend URL and create a temporary study account. Run one question,
   then sign in with the same name and password in a private window or another
   browser. Verify that the assigned group, current stage, source code, terminal
   result, and generated feedback are restored. Also verify both Group A and
   Group B through the final survey. The backend health check is available at
   `/health`.

Render supplies HTTPS for both public URLs. The backend currently allows public
cross-origin requests, while participant-bound study operations validate the
opaque registration token issued at sign-in.

## Updating the existing Render deployment

1. Keep both services on the `UF_1_toolEval` branch and push the completed
   changes to that branch.
2. Keep the backend's existing `DATABASE_URL`. Do not create a second database
   and do not manually delete the old tables.
3. Redeploy the backend first. Its deploy log should show
   `Study database is ready.` before Gunicorn starts; this confirms that the
   account and recovery tables were initialized.
4. Redeploy the frontend after the backend is healthy so both services use the
   same API revision.
5. Complete the private-window recovery check described above before sharing
   the study URL.

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

Students enter their name and create a password in **Participant information**.
PostgreSQL stores the research-demo password in recoverable form and assigns a
persistent alternating group. Database access must therefore remain restricted
to the study administrators. Student names are unique within this deployment;
passwords do not need to be unique.
The browser token preserves the session after a refresh; the name and password
can restore it from another browser. PostgreSQL also stores the latest study
navigation and one current workspace for each question, so code drafts,
terminal results, flowcharts, traces, and textual feedback follow the
participant.

Browser local storage still provides fast refresh recovery. PostgreSQL stores
the latest navigation state and question workspaces for cross-device recovery.
Separately, every Run Code click creates one immutable submission containing the student name,
group, question, per-question attempt number, source code,
feedback format, terminal result, and either the flowchart/trace workspace or
the textual-feedback workspace.

## AI usage limits

Every completed model call is recorded in `llm_usage_events`. The backend uses
the configured model's token rates to estimate each participant's accumulated
cost and blocks further paid generation after the participant reaches the
$1.00 study allowance. Native C++ traces do not consume model tokens; an LLM
trace fallback does. The participant UI displays the current estimated spend,
and the administrator usage view aggregates token counts and cost across the
study.
