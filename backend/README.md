# CodeFlow Backend

## Configuration

Copy `.env.example` to `.env`, then fill in the values:

```dotenv
PROVIDER=openai
BASE_URL=https://api.openai.com/v1
MODEL=gpt-5.6-sol
API_KEY=your-openai-api-key
RESEARCH_PASSWORD=your-study-password
```

Do not commit `.env` or your API key.

## Install

Python 3.10 or newer is required.

### Git Bash on Windows

```bash
cd /c/Code/CodeFlow/backend
python -m venv venv
source venv/Scripts/activate
python -m pip install -r requirements.txt
```

### macOS or Linux

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
```

## Run

After activating the virtual environment:

```bash
python app.py
```

The backend runs at `http://127.0.0.1:5001`.

To leave the virtual environment:

```bash
deactivate
```

## Render

Set `PROVIDER`, `BASE_URL`, `MODEL`, `API_KEY`, and `RESEARCH_PASSWORD` in the
backend service's Render environment variables, then redeploy the service.
