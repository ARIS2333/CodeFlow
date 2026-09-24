# CodeFlow Backend Setup and Running Guide

## Requirements

- Python 3.10 or later
- Python 3.12.7 is recommended and matches the project's `.python-version`

Create a dedicated virtual environment for the backend. Do not copy a `venv` created on another computer or with another Python installation.

## Install dependencies

On macOS or Linux:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

On Windows PowerShell:

```powershell
cd backend
py -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

On Windows Git Bash:

```bash
cd backend
py -m venv venv
source venv/Scripts/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

After activation, these commands should use the Python installation inside the virtual environment:

```bash
python --version
python -m pip --version
```

If the terminal shows `(venv)` but reports that `python` cannot be found, the virtual environment was probably created by a Python installation that has since been removed or moved. Leave that environment and recreate it with the currently available `python3` or `py` command.

## Configure environment variables

On macOS, Linux, or Git Bash:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```dotenv
API_KEY=
BASE_URL=https://api.openai.com/v1
MODEL=gpt-5.6-sol
PROVIDER=openai
RESEARCH_PASSWORD=
```

| Variable | Purpose |
| --- | --- |
| `API_KEY` | Server-side API key for the shared research model |
| `BASE_URL` | Base API URL for the model provider |
| `MODEL` | Model used in shared research mode |
| `PROVIDER` | Model provider: `openai`, `dashscope`, `anthropic`, or `deepseek` |
| `RESEARCH_PASSWORD` | Password required to use shared research mode; leave empty to disable this mode |

To enable shared research mode, correctly configure `API_KEY`, `BASE_URL`, `MODEL`, `PROVIDER`, and `RESEARCH_PASSWORD`. If users will provide their own API keys, the shared research credentials can remain empty.

The development server also supports these optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FLASK_HOST` | `127.0.0.1` | Address on which the backend listens |
| `PORT` | `5001` | Port on which the backend listens |
| `FLASK_DEBUG` | Disabled | Set to `1` to enable Flask debug mode |

## Start the development server

Activate the virtual environment, then run:

```bash
python app.py
```

The default service address is `http://127.0.0.1:5001`. Check its health with:

```bash
curl http://127.0.0.1:5001/api/health
```

## Run tests

```bash
python -m unittest discover -s tests
```

## Run in production

After installing the dependencies, start the backend with Gunicorn:

```bash
gunicorn app:app
```

The Gunicorn configuration reads the platform-provided `PORT` and supports optional settings such as `WEB_CONCURRENCY`, `GUNICORN_THREADS`, and `GUNICORN_TIMEOUT`.

For Render deployment and complete frontend and backend production configuration, see [../Docs/DEPLOYMENT.md](../Docs/DEPLOYMENT.md).
