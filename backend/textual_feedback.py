"""Server-owned prompt rendering for the study's textual condition."""

import json
from pathlib import Path


TEXTUAL_FEEDBACK_PROMPT = Path(__file__).with_name(
    "textual_feedback_prompt.txt"
).read_text(encoding="utf-8")
TEXTUAL_RETRACE_PROMPT = Path(__file__).with_name(
    "textual_retrace_prompt.txt"
).read_text(encoding="utf-8")


def render_textual_feedback_prompt(
    problem: dict,
    code: str,
    execution_input: str | None = None,
    previous_logic: dict | None = None,
) -> str:
    """Render a full independent analysis or an execution-only regeneration."""
    problem_text = json.dumps(problem, ensure_ascii=False, indent=2)
    if execution_input and previous_logic:
        return (
            TEXTUAL_RETRACE_PROMPT
            .replace("{{PROBLEM_DESCRIPTION}}", problem_text)
            .replace("{{STUDENT_SUBMISSION}}", code)
            .replace("{{STUDENT_LOGIC}}", previous_logic["student"])
            .replace("{{RECOMMENDED_LOGIC}}", previous_logic["recommended"])
            .replace("{{EXECUTION_INPUT}}", execution_input)
        )
    input_material = (
        f"<execution_input>\n{execution_input}\n</execution_input>"
        if execution_input else ""
    )
    return (
        TEXTUAL_FEEDBACK_PROMPT
        .replace("{{PROBLEM_DESCRIPTION}}", problem_text)
        .replace("{{STUDENT_SUBMISSION}}", code)
        .replace("{{EXECUTION_INPUT}}", input_material)
    )
