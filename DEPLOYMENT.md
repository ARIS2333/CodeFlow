# CodeFlow deployment on Render

CodeFlow stays as two small services plus a database:

- `codeflow-frontend`: a Render Static Site built from `frontend/dist`.
- `codeflow-backend`: the Flask application served by Gunicorn.
- `codeflow-db`: a managed Render Postgres instance.

The repository-root `render.yaml` creates both services from the `production`
branch. Flask's development server and Vite's development/preview server are
not exposed publicly.

## First deployment

1. Push the `production` branch to the Git provider connected to Render.
2. In Render, choose **New > Blueprint**, select this repository, and use the
   root-level `render.yaml`.
3. Enter `DASHSCOPE_API_KEY` and `DASHSCOPE_WORKSPACE_ID` when Render asks for
   the backend secrets. `DATABASE_URL` is not among them: the blueprint wires it
   from `codeflow-db` automatically.
4. Let Render create the database and the backend, then copy the backend's
   public HTTPS URL.
5. Set the frontend service's `VITE_API_BASE_URL` to that URL, with no trailing
   slash (for example, `https://codeflow-backend.onrender.com`). Redeploy the
   frontend so Vite includes the value in its static build.
6. Open the frontend URL and verify upload, Run, flowchart streaming, trace, and
   Clear. The backend health check is available at `/health`.

Render supplies HTTPS for both public URLs. The backend intentionally keeps its
current public CORS behavior until the planned login/BYOK work is requested.

## Database

`codeflow-db` currently runs on the **free** plan, which is appropriate only
while the schema and authentication work is still in development. The database
and the backend are both pinned to `oregon` so that `DATABASE_URL` resolves to
the private network URL instead of the slower public one.

### The free instance expires — upgrade before the study

Render expires a free Postgres instance **30 days after it is created**. A
14-day grace period follows, during which upgrading to a paid plan keeps all
data. After that Render deletes the database and its contents permanently.
Render emails warnings as each deadline approaches.

Record the creation date when the blueprint first provisions the database, and
upgrade to `0.1c-256mb` ($6/month, 1 GB storage included, then $0.30/GB) before
collecting any participant data. Upgrading is a plan change in the Render
dashboard; it preserves the data, so no dump and restore is needed. Change
`plan: free` to `plan: 0.1c-256mb` in `render.yaml` at the same time, so the
blueprint does not disagree with the running instance.

The free plan additionally has no backups, no managed connection pooling, a 1 GB
storage cap, and permits only one free instance per workspace. Its connection
limit is the same 100 as the Basic plan, so the pool settings below apply
unchanged.

Schema changes run through `preDeployCommand: alembic upgrade head`, after the
build and before the new version serves traffic. A failing migration fails the
deploy and leaves the previous version running.

Keep `WEB_CONCURRENCY * (DB_POOL_SIZE + DB_MAX_OVERFLOW)` below the instance's
100-connection limit. The defaults reserve 20. Raising `GUNICORN_THREADS` does
not by itself consume more connections, but raising `WEB_CONCURRENCY` does, so
change the two together. Storage autoscaling is off by default; enable it in the
dashboard, or watch the storage metric, before a study run.

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

## Future work deliberately not enabled

Authentication is postponed until explicitly requested. The intended behavior
is: students who log in with the study password may use the server-funded API;
other visitors must provide their own API credential. Per-participant quotas or
a study-wide spending cap can be added at the same time if desired.
