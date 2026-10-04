"""Persistence for human-study Run Code submissions."""

from __future__ import annotations

import os
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS submissions (
    submission_id UUID PRIMARY KEY,
    participant_name TEXT NOT NULL,
    participant_email TEXT NOT NULL,
    study_group TEXT NOT NULL CHECK (study_group IN ('A', 'B')),
    question_id TEXT NOT NULL CHECK (question_id IN ('q1', 'q2', 'q3', 'q4')),
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    source_code TEXT NOT NULL,
    language TEXT NOT NULL,
    feedback_format TEXT NOT NULL
        CHECK (feedback_format IN ('codeflow', 'textual')),
    terminal_result JSONB,
    flowchart JSONB,
    code_trace JSONB,
    textual_feedback JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (participant_email, question_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS submissions_email_index
    ON submissions (participant_email);

CREATE INDEX IF NOT EXISTS submissions_question_index
    ON submissions (question_id);
"""


class DatabaseNotConfigured(RuntimeError):
    """The deployment has no database connection configured."""


def database_url() -> str:
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise DatabaseNotConfigured("DATABASE_URL is not configured")
    return value


def connect():
    return psycopg.connect(database_url())


def initialize_database() -> None:
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(SCHEMA_SQL)


def create_submission_record(
    *,
    submission_id: UUID,
    participant_name: str,
    participant_email: str,
    study_group: str,
    question_id: str,
    source_code: str,
    language: str,
    feedback_format: str,
) -> dict[str, Any]:
    """Create one immutable code attempt and allocate its per-question number."""
    attempt_key = f"{participant_email}:{question_id}"

    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT attempt_number FROM submissions WHERE submission_id = %s",
                (submission_id,),
            )
            existing = cursor.fetchone()
            if existing:
                return {
                    "submissionId": str(submission_id),
                    "attemptNumber": existing[0],
                }

            # A participant can have the study open in two tabs. Serializing
            # this email/question pair prevents both clicks receiving the same
            # MAX(attempt_number) + 1 value.
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                (attempt_key,),
            )
            # A network retry can arrive while its first request holds the
            # lock. Check the idempotency key again after acquiring it.
            cursor.execute(
                "SELECT attempt_number FROM submissions WHERE submission_id = %s",
                (submission_id,),
            )
            existing = cursor.fetchone()
            if existing:
                return {
                    "submissionId": str(submission_id),
                    "attemptNumber": existing[0],
                }
            cursor.execute(
                """
                SELECT COALESCE(MAX(attempt_number), 0) + 1
                FROM submissions
                WHERE participant_email = %s AND question_id = %s
                """,
                (participant_email, question_id),
            )
            attempt_number = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO submissions (
                    submission_id,
                    participant_name,
                    participant_email,
                    study_group,
                    question_id,
                    attempt_number,
                    source_code,
                    language,
                    feedback_format
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    submission_id,
                    participant_name,
                    participant_email,
                    study_group,
                    question_id,
                    attempt_number,
                    source_code,
                    language,
                    feedback_format,
                ),
            )

    return {
        "submissionId": str(submission_id),
        "attemptNumber": attempt_number,
    }


_UPDATE_COLUMNS = {
    "terminalResult": "terminal_result",
    "flowchart": "flowchart",
    "codeTrace": "code_trace",
    "textualFeedback": "textual_feedback",
}


def update_submission_record(
    submission_id: UUID,
    updates: dict[str, Any],
) -> bool:
    """Merge completed workspace components into one Run Code attempt."""
    assignments: list[str] = []
    values: list[Any] = []
    for public_name, column_name in _UPDATE_COLUMNS.items():
        if public_name not in updates:
            continue
        assignments.append(f"{column_name} = %s")
        values.append(Jsonb(updates[public_name]))

    if not assignments:
        return False

    assignments.append("updated_at = NOW()")
    values.append(submission_id)
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                UPDATE submissions
                SET {', '.join(assignments)}
                WHERE submission_id = %s
                """,
                values,
            )
            return cursor.rowcount == 1
