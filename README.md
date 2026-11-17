# CodeFlow Setup and Running Guide

## About CodeFlow

CodeFlow is a web-based programming feedback tool built around **flowchart comparison** and **execution tracing**. Instead of returning only a pass-or-fail result, it converts a student's solution into a flowchart and places it next to a flowchart of a correct solution. Students can compare the two structures visually to see differences in decisions, loops, execution order, and missing or incorrect steps.

The comparison continues beyond the static diagrams. CodeFlow can run the same test input through both flowcharts at the same time and replay their execution one step at a time. At each step, students can see the active block and current variable values, allowing them to observe where the two executions begin to behave differently.

This combination provides two complementary views of a mistake:

- **Flowchart comparison** shows how the student's overall logic differs from a correct approach.
- **Execution tracing** shows when and why those differences affect the program for a specific input.

CodeFlow currently supports Java, Python, and C++.

## SQL education workspace

Open **SQL workspace** in the header, or visit `/sql`. This separate mode uses
DuckDB SQL for teaching relational logic. Enter an exercise, supply small teaching
tables (schema and rows as JSON), and write a SELECT query. The Load Example menu includes JOIN/grouping, CASE, correlated EXISTS, CTE,
set-difference and window-ranking exercises with deliberately flawed queries. It uses the same model settings as the programming mode.

Run Code executes the student query, then asks the LLM for a minimally repaired
recommended query and executes it against the same data in a separate in-memory
database. The two logical flows are built from SQLGlot parsing rather than model
generated nodes. SQL uses the existing CodeFlow layout: the problem, teaching
tables, CodeMirror editor, and Output are on the left; the resizable Code Analysis
sidebar contains both flowcharts and the execution trace. Existing zoom,
full-screen views, and Start/Prev/Next/End/Reset controls are reused. Intermediate
result tables replace variable cards. After editing table data,
**Re-trace with current tables** executes the existing query pair without an AI call.

The workspace supports read-only DuckDB queries with INNER/LEFT/RIGHT/FULL/CROSS
JOIN (ON or USING), WHERE (including IN, EXISTS, LIKE, BETWEEN and NULL predicates),
GROUP BY, HAVING, DISTINCT, ORDER BY, LIMIT/OFFSET, CASE, nonrecursive CTEs, derived
tables, scalar/correlated subqueries, UNION/INTERSECT/EXCEPT (including ALL), and
common window functions (ranking, LAG/LEAD, and aggregate windows). Common numeric,
string, casting and date functions are allowlisted. Teaching column types are
INTEGER, DOUBLE, VARCHAR, BOOLEAN, DATE and TIMESTAMP. Writes, recursive CTEs,
extensions, external files and external database access are excluded. Each request creates a fresh
DuckDB database in a child process, with a 12-second deadline and a 128 MB engine
memory limit. Tables are limited to six, with up to 20 columns and 200 rows each;
result previews are capped at 200 rows.

Stages express logical data transformations, not the engine's physical execution
plan. Two traces align by semantic phase instead of numeric step: a missing WHERE,
for example, is left unpaired. Filters show kept and excluded rows (FALSE and NULL);
CASE shows first-matching branches; set queries have two incoming query paths.
For JOIN ON and ordinary grouping, select a result row to highlight matching input
values or contributing rows. Identical displayed tuples are highlighted together;
this is value correspondence, not unique physical row provenance. USING joins show
input/output tables without row links. Grouping and projection share a stage,
with HAVING separately showing excluded groups. CTEs and derived tables have nested
stages; correlated predicates execute in context rather than inventing standalone
subquery runs. Some alias-dependent expressions cannot be independently staged;
those queries show real complete results with an explicit explanation of the trace
boundary. Result previews and row highlights are limited to visible rows.
The original SQL is executed for the final result. Result comparison preserves duplicate rows and ignores row order unless
the recommendation specifies ORDER BY; it does not establish equivalence on
unseen datasets or independently prove the AI recommendation correct.

## How feedback is generated

The student flowchart is built deterministically from Tree-sitter source analysis
and control-flow relationships. The LLM receives the problem and the student's
complete source, then proposes a corrected implementation under a minimal-repair
policy: retain valid control structures, data structures, variable names, and
implementation choices. The recommended source passes through the same analysis
pipeline to produce the comparison flowchart. Recommended code is checked for
syntax/compilation issues; this does not prove logical correctness.

Tree-sitter can recover parts of a submission containing syntax errors, so the
tool can still display a student flowchart and highlight supported source issues.
The terminal uses Python syntax checking and real C++ compilation diagnostics.
A blocking syntax or compilation error prevents execution tracing. Submissions
containing multiple function definitions are rejected before feedback generation.

| Language | Flowcharts | Execution trace |
| --- | --- | --- |
| Python | Deterministic source analysis for both implementations | AST instrumentation and real execution when enabled; LLM fallback |
| C++ | Deterministic source analysis for both implementations | Source instrumentation, `g++` compilation, and real execution for supported calls when enabled; LLM fallback |
| Java | Deterministic source analysis for both implementations | LLM simulation |

Native traces capture visited node IDs and bounded variable snapshots from both
implementations. The frontend validates that steps follow the displayed graph.
Unsupported instrumentation, execution failures, or unavailable native tracing
trigger the model-generated trace fallback. Python currently supports a bounded
subset of single-function programs; async functions, generators, recursion,
try/with, loop else clauses, break, and continue fall back to the model. Inputs
must be function calls with literal positional arguments. The C++ native harness
currently supports `isNumUnique`, `two_sum`, `findTheDigits`, and `findMode`;
other functions use the model fallback.

The terminal's test cases, expected answers, and student outputs remain
LLM-generated simulations. Native execution tracing does not turn the terminal
into a real execution-based grader.

## Core features

- **Side-by-side flowchart comparison** — displays the student's flowchart beside a correct reference flowchart so their structures and execution paths can be compared directly.
- **Student-specific reference solution** — presents a correct flow that is suitable for comparison with the student's attempted approach, rather than limiting feedback to a single fixed implementation.
- **Source issue highlighting** — marks supported syntax-level source issues while leaving students to discover logic differences by comparing the two flows.
- **Synchronized execution trace** — sends the same input through both flowcharts and advances their executions together, one block at a time.
- **Runtime state inspection** — shows variable changes and the complete current variable state at each trace step.
- **Custom trace inputs** — allows students to try another input and explore different branches or edge cases.
- **Flexible chart viewing** — supports deep zooming, automatic viewport fitting, and full-screen comparison and trace views for large flowcharts or smaller screens.
- **Problem and code workspace** — supports preparing a programming problem, writing Java, Python, or C++ code, running it against tests, and reviewing the resulting feedback in one place.

## Typical workflow

1. Enter a programming problem.
2. Write a solution in Java, Python, or C++.
3. Run the solution and review the test results.
4. Generate the student flowchart and a correct reference flowchart.
5. Compare the two charts side by side and inspect any highlighted source issues.
6. Trace the same test input through both charts simultaneously.
7. Inspect the active blocks and variable values at each step.
8. Step manually or jump to the beginning or end to identify where the student's behavior becomes incorrect.

## Requirements

- Git
- Node.js 22.14.0 for the frontend
- Python 3.10 or later for the backend; Python 3.12.7 is recommended
- `g++` with C++17 support for authoritative C++ compile diagnostics

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

For local testing with credentials read directly from `backend/.env`, add:

```dotenv
ALLOW_LOCAL_ENV_MODEL=true
ENABLE_NATIVE_PYTHON_TRACE=true
ENABLE_NATIVE_CPP_TRACE=true
```

`ALLOW_LOCAL_ENV_MODEL` enables the local frontend to request the server's model
without entering credentials in the settings panel. Keep it disabled on public
deployments. API keys remain on the backend.

Native execution runs submitted code in child processes with resource limits;
these limits are not an OS security sandbox. Enable it in a deployment suitable
for executing submitted programs. See [backend/README.md](backend/README.md) for
timeouts and supported execution settings.

Start the backend:

```bash
python app.py
```

The default address is `http://127.0.0.1:5001`. Confirm that the service is running with:

```bash
curl http://127.0.0.1:5001/health
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
VITE_LOCAL_SERVER_MODEL=true
```

`VITE_LOCAL_SERVER_MODEL=true` applies only to the Vite development server. It
uses the backend environment configuration automatically and hides the model
settings button. Restart the development server after changing environment files.

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

The main-branch Blueprint is [render.yaml](render.yaml). To enable native traces
on the backend, explicitly set `ENABLE_NATIVE_CPP_TRACE=true` and/or
`ENABLE_NATIVE_PYTHON_TRACE=true` in Render. Python tracing uses the backend
interpreter. C++ tracing requires `g++` at runtime. The Blueprint includes
separate C++ trace compilation/run timeouts and a Python run timeout. Java native
execution is not implemented. Native trace failures retain the LLM fallback.
