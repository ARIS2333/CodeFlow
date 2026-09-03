# CodeFlow

> 📄 Source code for our SIGCSE TS 2026 poster: **CodeFlow: LLM-Generated
> Flowchart Feedback for Programming Students**
> https://dl.acm.org/doi/10.1145/3770761.3777175
>
> 🎥 Introductory video demo: https://www.youtube.com/watch?v=m0TiXVROR7g

CodeFlow is a web-based feedback system for programming students. A student
uploads a practice problem, writes a solution, and runs it — and instead of
just a pass/fail verdict, CodeFlow turns their code into a **flowchart**,
marks the syntax and logic errors directly on it, and places it next to a
flowchart of a correct solution. The student sees exactly *where* their
logic diverges from the correct approach, without the answer being handed
to them outright.

## Why flowcharts

Text explanations from an LLM can tell a student *that* their code is wrong,
but programming logic — branches, loops, the order conditions are checked
in — is often easier to see than to read about. Flowcharts have long been
used in CS education to help students visualize control flow and build
computational thinking, but hand-drawing them for every student's own code
doesn't scale. CodeFlow uses an LLM to generate that flowchart automatically,
in real time, from whatever the student actually wrote — including their
mistakes.

## What it does

- **Personalized problems** — students paste in their own practice problem;
  the system reformats it and generates illustrative examples.
- **Code decomposition & visualization** — an error-tolerant Tree-sitter pass
  first anchors the student's Java or Python structures to exact source
  locations. The LLM uses those facts to build nodes and control-flow edges,
  and local semantic validation checks the result before it is rendered.
- **Error detection** — syntax errors (e.g. `=` vs `==`, missing semicolons,
  missing return values) and logic errors (wrong conditionals, missing or
  misordered steps) are highlighted directly on the student's flowchart.
- **Side-by-side comparison** — a second, correct flowchart is generated
  alongside the student's, adapted to whatever algorithmic approach the
  student took, so the comparison stays fair rather than prescribing one
  "right" solution.

## How a session works

1. **Upload a problem** — paste a problem description; the LLM structures
   it into a title, description, and examples.
2. **Write a solution** — the built-in editor supports Java and Python.
3. **Run it** — the LLM evaluates correctness against test cases and shows
   the results.
4. **View flowcharts** — a panel opens showing the student's flowchart
   (errors highlighted in red) next to the reference flowchart, laid out
   automatically (Dagre) and adjustable by hand.

## Paper

This repo is the source code for our SIGCSE TS 2026 poster:

> Kehao Zheng and Yang Shi. 2026. **CodeFlow: LLM-Generated Flowchart
> Feedback for Programming Students.** In Proceedings of the 57th ACM
> Technical Symposium on Computer Science Education V.2 (SIGCSE TS 2026),
> February 18–21, 2026, St. Louis, MO, USA.
> https://dl.acm.org/doi/10.1145/3770761.3777175

```bibtex
@inproceedings{zheng2026codeflow,
  title     = {CodeFlow: LLM-Generated Flowchart Feedback for Programming Students},
  author    = {Zheng, Kehao and Shi, Yang},
  booktitle = {Proceedings of the 57th ACM Technical Symposium on Computer Science Education V.2 (SIGCSE TS 2026)},
  year      = {2026},
  doi       = {10.1145/3770761.3777175}
}
```

## Repo layout

```
frontend/   The web app students interact with
backend/    Local server that talks to the AI model on the frontend's behalf
Exercise/   A reference dataset of real student code submissions
```

See `frontend/README.md` and `backend/README.md` for how to run each piece.
