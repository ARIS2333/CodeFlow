# CodeFlow Setup and Running Guide

## Requirements

- Git
- Node.js 22.14.0 for the frontend
- Python 3.10 or later for the backend; Python 3.12.7 is recommended

The frontend and backend must run in separate terminals.

## 1. Get the project

```bash
git clone https://github.com/ARIS2333/CodeFlow.git
cd CodeFlow
```

## 2. Configure and run the backend

On macOS or Linux:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

On Windows PowerShell:

```powershell
cd backend
py -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env`:

```dotenv
API_KEY=
BASE_URL=https://api.openai.com/v1
MODEL=gpt-5.6-sol
PROVIDER=openai
RESEARCH_PASSWORD=
```

- To enable the shared research model, provide the complete model configuration and set `RESEARCH_PASSWORD`.
- To allow only user-provided API keys, leave the server credentials and `RESEARCH_PASSWORD` empty.
- `PROVIDER` can be `openai`, `dashscope`, `anthropic`, or `deepseek`.

Start the backend:

```bash
python app.py
```

The default address is `http://127.0.0.1:5001`. Confirm that the service is running with:

```bash
curl http://127.0.0.1:5001/api/health
```

## 3. Configure and run the frontend

Open a second terminal and run the following commands from the project root:

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
```

On Windows PowerShell, create the environment file with:

```powershell
Copy-Item .env.example .env
```

For local development, `frontend/.env` will normally contain:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:5001
```

Open the frontend address shown in the terminal, usually `http://localhost:5173`.

## 4. Check the project

Run the backend tests:

```bash
cd backend
source venv/bin/activate
python -m unittest discover -s tests
```

Run the frontend checks:

```bash
cd frontend
npm test
npm run lint
npm run build
```

On Windows, use the appropriate virtual environment activation command before running the backend tests.

## 5. Deployment

For production environment variables, frontend and backend configuration, and Render deployment instructions, see [Docs/DEPLOYMENT.md](Docs/DEPLOYMENT.md).
