"""Attach completed model calls to study participants without blocking feedback."""

from __future__ import annotations

import logging
from typing import Any, Callable
from uuid import UUID

from database import record_llm_usage


logger = logging.getLogger(__name__)

ALLOWED_OPERATIONS = {
    "feedback",
    "grounded flowchart",
    "model-inferred flowchart",
    "execution trace",
    "textual feedback",
    "textual retrace",
}


def usage_recorder(
    body: dict[str, Any],
    *,
    provider: str,
    operation: str,
    request_id: str | None,
) -> Callable[[str, dict[str, Any]], None] | None:
    """Build a best-effort recorder for participant-mode requests only."""
    model_config = body.get("modelConfig")
    if not isinstance(model_config, dict):
        return None
    try:
        registration_id = UUID(str(model_config.get("registrationId", "")))
    except ValueError:
        return None

    context = model_config.get("usageContext")
    context = context if isinstance(context, dict) else {}
    question_id = context.get("questionId")
    feedback_format = context.get("feedbackFormat")
    if question_id not in {"q1", "q2", "q3", "q4"}:
        question_id = None
    if feedback_format not in {"codeflow", "textual"}:
        feedback_format = None
    if operation not in ALLOWED_OPERATIONS:
        operation = "model request"

    def record(model: str, usage: dict[str, Any]) -> None:
        try:
            record_llm_usage(
                registration_id=registration_id,
                request_id=request_id,
                question_id=question_id,
                feedback_format=feedback_format,
                operation=operation,
                provider=provider,
                model=model,
                usage=usage,
            )
        except Exception:
            # Feedback must still reach the student if usage telemetry fails.
            logger.exception("LLM usage could not be saved")

    return record
