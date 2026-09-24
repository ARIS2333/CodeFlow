# CodeFlow Setup and Running Guide

## About CodeFlow

CodeFlow is a web-based programming feedback tool built around **flowchart comparison** and **execution tracing**. Instead of returning only a pass-or-fail result, it converts a student's solution into a flowchart and places it next to a flowchart of a correct solution. Students can compare the two structures visually to see differences in decisions, loops, execution order, and missing or incorrect steps.

The comparison continues beyond the static diagrams. CodeFlow can run the same test input through both flowcharts at the same time and replay their execution one step at a time. At each step, students can see the active block, the path taken, and the current variable values. When the two executions separate, CodeFlow identifies the first divergence point, helping the student connect an incorrect result to the exact decision or operation that caused it.

This combination provides two complementary views of a mistake:

- **Flowchart comparison** shows how the student's overall logic differs from a correct approach.
- **Execution tracing** shows when and why those differences affect the program for a specific input.

CodeFlow currently supports Java, Python, and C++.

## Core features

- **Side-by-side flowchart comparison** — displays the student's flowchart beside a correct reference flowchart so their structures and execution paths can be compared directly.
- **Student-specific reference solution** — presents a correct flow that is suitable for comparison with the student's attempted approach, rather than limiting feedback to a single fixed implementation.
- **Visual error highlighting** — marks syntax and logic issues on the student's chart and connects feedback to the relevant part of the program flow.
- **Synchronized execution trace** — sends the same input through both flowcharts and advances their executions together, one block at a time.
- **Divergence detection** — finds the first step where the student's execution differs from the correct execution, making the source of an incorrect result easier to locate.
- **Runtime state inspection** — shows variable values and the selected branch at each trace step, providing context for why the paths remain aligned or separate.
- **Custom trace inputs** — allows students to try another input and explore different branches or edge cases.
- **Problem and code workspace** — supports preparing a programming problem, writing Java, Python, or C++ code, running it against tests, and reviewing the resulting feedback in one place.

## Typical workflow

1. Enter a programming problem.
2. Write a solution in Java, Python, or C++.
3. Run the solution and review the test results.
4. Generate the student flowchart and a correct reference flowchart.
5. Compare the two charts side by side and inspect highlighted issues.
6. Trace the same test input through both charts simultaneously.
7. Inspect the active blocks and variable values at each step.
8. Jump to the first divergence to identify where the student's behavior becomes incorrect.

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
