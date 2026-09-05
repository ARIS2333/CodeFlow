# CodeFlow deployment on Render

CodeFlow stays as two small services:

- `codeflow-frontend`: a Render Static Site built from `frontend/dist`.
- `codeflow-backend`: the Flask application served by Gunicorn.

The repository-root `render.yaml` creates both services from the `production`
branch. Flask's development server and Vite's development/preview server are
not exposed publicly.

## First deployment

1. Push the `production` branch to the Git provider connected to Render.
2. In Render, choose **New > Blueprint**, select this repository, and use the
   root-level `render.yaml`.
3. Enter `DASHSCOPE_API_KEY` and `DASHSCOPE_WORKSPACE_ID` when Render asks for
   the backend secrets.
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

## Future work deliberately not enabled

Authentication is postponed until explicitly requested. The intended behavior
is: students who log in with the study password may use the server-funded API;
other visitors must provide their own API credential. Per-participant quotas or
a study-wide spending cap can be added at the same time if desired.
