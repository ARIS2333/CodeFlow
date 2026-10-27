"""Persistence for human-study Run Code submissions."""

from __future__ import annotations

import os
from decimal import Decimal
from threading import Lock
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS study_participants (
    registration_id UUID PRIMARY KEY,
    student_name TEXT NOT NULL,
    participant_password TEXT NOT NULL,
    assignment_number INTEGER NOT NULL UNIQUE CHECK (assignment_number > 0),
    study_group TEXT NOT NULL CHECK (study_group IN ('A', 'B')),
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submissions (
    submission_id UUID PRIMARY KEY,
    registration_id UUID REFERENCES study_participants(registration_id),
    student_name TEXT,
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
    UNIQUE (registration_id, question_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS participant_progress (
    registration_id UUID PRIMARY KEY
        REFERENCES study_participants(registration_id) ON DELETE CASCADE,
    progress JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participant_workspaces (
    registration_id UUID NOT NULL
        REFERENCES study_participants(registration_id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    workspace JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (registration_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS llm_usage_events (
    usage_id BIGSERIAL PRIMARY KEY,
    registration_id UUID NOT NULL
        REFERENCES study_participants(registration_id) ON DELETE CASCADE,
    request_id TEXT,
    question_id TEXT CHECK (question_id IN ('q1', 'q2', 'q3', 'q4')),
    feedback_format TEXT CHECK (feedback_format IN ('codeflow', 'textual')),
    operation TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens >= 0),
    cache_write_tokens INTEGER NOT NULL CHECK (cache_write_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
    latency_seconds DOUBLE PRECISION,
    estimated_cost_usd NUMERIC(14, 8),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS registration_id UUID;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS student_name TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS participant_id TEXT;
ALTER TABLE study_participants ADD COLUMN IF NOT EXISTS participant_password TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'submissions' AND column_name = 'participant_name'
    ) THEN
        ALTER TABLE submissions ALTER COLUMN participant_name DROP NOT NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'submissions' AND column_name = 'participant_email'
    ) THEN
        ALTER TABLE submissions ALTER COLUMN participant_email DROP NOT NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'submissions' AND column_name = 'participant_id'
    ) THEN
        ALTER TABLE submissions ALTER COLUMN participant_id DROP NOT NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS submissions_registration_attempt_index
    ON submissions (registration_id, question_id, attempt_number)
    WHERE registration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS submissions_registration_index
    ON submissions (registration_id);

CREATE INDEX IF NOT EXISTS submissions_question_index
    ON submissions (question_id);

CREATE INDEX IF NOT EXISTS llm_usage_registration_index
    ON llm_usage_events (registration_id, created_at);

CREATE INDEX IF NOT EXISTS llm_usage_question_index
    ON llm_usage_events (question_id);

DROP INDEX IF EXISTS study_participants_unique_password_index;

CREATE UNIQUE INDEX IF NOT EXISTS study_participants_unique_name_index
    ON study_participants (LOWER(student_name));
"""


class DatabaseNotConfigured(RuntimeError):
    """The deployment has no database connection configured."""


class InvalidStudentLogin(ValueError):
    """A returning student's name and password do not match."""


class DuplicateStudentName(ValueError):
    """A participant tried to register a name already used in this study."""


_schema_lock = Lock()
_schema_initialized = False
PARTICIPANT_USAGE_LIMIT_USD = Decimal("1.00")


def database_url() -> str:
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise DatabaseNotConfigured("DATABASE_URL is not configured")
    return value


def connect():
    return psycopg.connect(database_url())


def normalize_student_name(value: str) -> str:
    """Collapse incidental whitespace without changing a student's spelling."""
    return " ".join(value.split())


def participant_usage_summary(registration_id: UUID) -> dict[str, Any]:
    """Return the recorded server-funded model spend for one participant."""
    initialize_database()
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COALESCE(SUM(estimated_cost_usd), 0)
                FROM llm_usage_events
                WHERE registration_id = %s
                """,
                (registration_id,),
            )
            spent = Decimal(cursor.fetchone()[0] or 0)
    remaining = max(PARTICIPANT_USAGE_LIMIT_USD - spent, Decimal("0"))
    return {
        "spentUsd": float(spent),
        "limitUsd": float(PARTICIPANT_USAGE_LIMIT_USD),
        "remainingUsd": float(remaining),
        "exhausted": spent >= PARTICIPANT_USAGE_LIMIT_USD,
    }


def admin_study_summary() -> dict[str, Any]:
    """Aggregate separately before joining so submissions never multiply usage."""
    initialize_database()
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT p.registration_id, p.student_name, p.study_group,
                       COALESCE(u.tokens, 0), COALESCE(u.cost, 0),
                       COALESCE(s.q1, 0), COALESCE(s.q2, 0),
                       COALESCE(s.q3, 0), COALESCE(s.q4, 0)
                FROM study_participants p
                LEFT JOIN (
                    SELECT registration_id, SUM(total_tokens) AS tokens,
                           SUM(estimated_cost_usd) AS cost
                    FROM llm_usage_events GROUP BY registration_id
                ) u ON u.registration_id = p.registration_id
                LEFT JOIN (
                    SELECT registration_id,
                           COUNT(*) FILTER (WHERE question_id = 'q1') AS q1,
                           COUNT(*) FILTER (WHERE question_id = 'q2') AS q2,
                           COUNT(*) FILTER (WHERE question_id = 'q3') AS q3,
                           COUNT(*) FILTER (WHERE question_id = 'q4') AS q4
                    FROM submissions GROUP BY registration_id
                ) s ON s.registration_id = p.registration_id
                ORDER BY p.assignment_number
            """)
            participants = [{
                "registrationId": str(row[0]), "studentName": row[1],
                "group": row[2], "totalTokens": int(row[3]),
                "estimatedCostUsd": float(row[4]),
                "runs": {f"q{i}": int(row[i + 4]) for i in range(1, 5)},
            } for row in cursor.fetchall()]
    return {"participants": participants, "totals": study_usage_summary()}


def study_usage_summary() -> dict[str, Any]:
    """Return privacy-preserving aggregate model usage for the whole study."""
    initialize_database()
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*),
                       COALESCE(SUM(input_tokens), 0),
                       COALESCE(SUM(cached_input_tokens), 0),
                       COALESCE(SUM(cache_write_tokens), 0),
                       COALESCE(SUM(output_tokens), 0),
                       COALESCE(SUM(total_tokens), 0),
                       COALESCE(SUM(estimated_cost_usd), 0)
                FROM llm_usage_events
                """
            )
            row = cursor.fetchone()
    return {
        "modelCalls": int(row[0]),
        "inputTokens": int(row[1]),
        "cachedInputTokens": int(row[2]),
        "cacheWriteTokens": int(row[3]),
        "outputTokens": int(row[4]),
        "totalTokens": int(row[5]),
        "estimatedCostUsd": float(Decimal(row[6] or 0)),
    }


def initialize_database() -> None:
    """Create the study schema once per worker, safely across workers.

    Render services created before submission persistence was added can retain
    an older Start Command. Lazy initialization keeps those deployments usable,
    while the transaction advisory lock serializes concurrent worker startup.
    """
    global _schema_initialized
    if _schema_initialized:
        return
    with _schema_lock:
        if _schema_initialized:
            return
        with connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))",
                    ("codeflow-study-schema-v1",),
                )
                cursor.execute(SCHEMA_SQL)
        _schema_initialized = True


def register_participant_record(
    *,
    registration_id: UUID,
    student_name: str,
    password: str,
    action: str,
) -> dict[str, Any]:
    """Create, resume, or update a participant account.

    A transaction-level advisory lock serializes new registrations across all
    Render workers. New registrations alternate A, B, A, B. Names are unique
    case-insensitively, while different students may choose the same password.
    A returning student is located by the name/password combination. This research-demo
    deployment intentionally stores the participant password in recoverable
    form so the study administrator can help a participant who forgets it.
    """
    initialize_database()
    normalized_name = normalize_student_name(student_name)
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                ("codeflow-study-participant-registration-v1",),
            )
            if action == "login":
                cursor.execute(
                    """
                    SELECT registration_id, student_name, study_group, participant_password
                    FROM study_participants
                    WHERE LOWER(student_name) = LOWER(%s)
                    ORDER BY assignment_number
                    """,
                    (normalized_name,),
                )
                for matched_id, matched_name, matched_group, saved_password in cursor.fetchall():
                    if saved_password == password:
                        return {
                            "registrationId": str(matched_id),
                            "studentName": matched_name,
                            "group": matched_group,
                        }
                raise InvalidStudentLogin("Name or password is incorrect.")

            cursor.execute(
                """
                SELECT assignment_number, study_group, participant_password
                FROM study_participants
                WHERE registration_id = %s
                """,
                (registration_id,),
            )
            existing = cursor.fetchone()
            cursor.execute(
                """
                SELECT 1
                FROM study_participants
                WHERE LOWER(student_name) = LOWER(%s)
                  AND registration_id <> %s
                LIMIT 1
                """,
                (normalized_name, registration_id),
            )
            if cursor.fetchone() is not None:
                raise DuplicateStudentName(
                    "This name is already registered. Please include your middle name and try again."
                )
            if existing:
                assignment_number, study_group, saved_password = existing
                if saved_password != password:
                    raise InvalidStudentLogin("Name or password is incorrect.")
                cursor.execute(
                    """
                    UPDATE study_participants
                    SET student_name = %s, updated_at = NOW()
                    WHERE registration_id = %s
                    """,
                    (normalized_name, registration_id),
                )
            else:
                cursor.execute(
                    "SELECT COALESCE(MAX(assignment_number), 0) + 1 FROM study_participants"
                )
                assignment_number = cursor.fetchone()[0]
                study_group = "A" if assignment_number % 2 == 1 else "B"
                cursor.execute(
                    """
                    INSERT INTO study_participants (
                        registration_id,
                        student_name,
                        participant_password,
                        assignment_number,
                        study_group
                    ) VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        registration_id,
                        normalized_name,
                        password,
                        assignment_number,
                        study_group,
                    ),
                )

    return {
        "registrationId": str(registration_id),
        "studentName": normalized_name,
        "group": study_group,
    }


def participant_registration(registration_id: UUID) -> dict[str, str] | None:
    """Return the registered name and group for an internal browser token."""
    initialize_database()
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT student_name, study_group
                FROM study_participants
                WHERE registration_id = %s
                """,
                (registration_id,),
            )
            row = cursor.fetchone()
    if row is None:
        return None
    return {"studentName": row[0], "group": row[1]}


def update_participant_name(
    registration_id: UUID,
    student_name: str,
) -> dict[str, str] | None:
    """Correct the name for a signed-in registration and its submissions."""
    initialize_database()
    normalized_name = normalize_student_name(student_name)
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                ("codeflow-study-participant-registration-v1",),
            )
            cursor.execute(
                """
                SELECT 1
                FROM study_participants
                WHERE LOWER(student_name) = LOWER(%s)
                  AND registration_id <> %s
                LIMIT 1
                """,
                (normalized_name, registration_id),
            )
            if cursor.fetchone() is not None:
                raise DuplicateStudentName(
                    "This name is already registered. Please include your middle name and try again."
                )
            cursor.execute(
                """
                UPDATE study_participants
                SET student_name = %s, updated_at = NOW()
                WHERE registration_id = %s
                RETURNING study_group
                """,
                (normalized_name, registration_id),
            )
            row = cursor.fetchone()
            if row is None:
                return None
            cursor.execute(
                """
                UPDATE submissions
                SET student_name = %s, updated_at = NOW()
                WHERE registration_id = %s
                """,
                (normalized_name, registration_id),
            )
    return {
        "registrationId": str(registration_id),
        "studentName": normalized_name,
        "group": row[0],
    }


OPENAI_TOKEN_RATES_PER_MILLION = {
    "gpt-6.1-sol": {
        "input": Decimal("2.00"),
        "cached": Decimal("0.10"),
        "cache_write": Decimal("2.50"),
        "output": Decimal("10.00"),
    },
}


def record_llm_usage(
    *,
    registration_id: UUID,
    request_id: str | None,
    question_id: str | None,
    feedback_format: str | None,
    operation: str,
    provider: str,
    model: str,
    usage: dict[str, Any],
) -> None:
    """Persist one completed provider call, including format-retry calls."""
    initialize_database()
    input_tokens = int(usage.get("input_tokens", usage.get("prompt_tokens", 0)) or 0)
    output_tokens = int(usage.get("output_tokens", usage.get("completion_tokens", 0)) or 0)
    cached_tokens = int(usage.get("cache_input_tokens", 0) or 0)
    cache_write_tokens = int(usage.get("cache_creation_input_tokens", 0) or 0)
    total_tokens = int(usage.get("total_tokens", input_tokens + output_tokens) or 0)
    latency = usage.get("time")

    estimated_cost = None
    rates = OPENAI_TOKEN_RATES_PER_MILLION.get(model) if provider == "openai" else None
    if rates:
        uncached_tokens = max(input_tokens - cached_tokens - cache_write_tokens, 0)
        estimated_cost = (
            Decimal(uncached_tokens) * rates["input"]
            + Decimal(cached_tokens) * rates["cached"]
            + Decimal(cache_write_tokens) * rates["cache_write"]
            + Decimal(output_tokens) * rates["output"]
        ) / Decimal(1_000_000)

    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO llm_usage_events (
                    registration_id, request_id, question_id, feedback_format,
                    operation, provider, model, input_tokens, cached_input_tokens,
                    cache_write_tokens, output_tokens, total_tokens,
                    latency_seconds, estimated_cost_usd
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    registration_id, request_id, question_id, feedback_format,
                    operation, provider, model, input_tokens, cached_tokens,
                    cache_write_tokens, output_tokens, total_tokens,
                    float(latency) if latency is not None else None, estimated_cost,
                ),
            )


def participant_study_state(registration_id: UUID) -> dict[str, Any]:
    """Return the participant's latest navigational and per-question state."""
    initialize_database()
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT progress FROM participant_progress WHERE registration_id = %s",
                (registration_id,),
            )
            progress_row = cursor.fetchone()
            cursor.execute(
                """
                SELECT workspace_id, workspace
                FROM participant_workspaces
                WHERE registration_id = %s
                ORDER BY workspace_id
                """,
                (registration_id,),
            )
            workspaces = {workspace_id: workspace for workspace_id, workspace in cursor.fetchall()}
    return {
        "progress": progress_row[0] if progress_row else None,
        "workspaces": workspaces,
    }


def save_participant_progress(registration_id: UUID, progress: dict[str, Any]) -> None:
    """Upsert the latest study-navigation snapshot for one participant."""
    initialize_database()
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO participant_progress (registration_id, progress)
                VALUES (%s, %s)
                ON CONFLICT (registration_id) DO UPDATE
                SET progress = EXCLUDED.progress, updated_at = NOW()
                """,
                (registration_id, Jsonb(progress)),
            )


def save_participant_workspace(
    registration_id: UUID,
    workspace_id: str,
    workspace: dict[str, Any],
) -> None:
    """Upsert the latest editor and generated-feedback state for one question."""
    initialize_database()
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO participant_workspaces (registration_id, workspace_id, workspace)
                VALUES (%s, %s, %s)
                ON CONFLICT (registration_id, workspace_id) DO UPDATE
                SET workspace = EXCLUDED.workspace, updated_at = NOW()
                """,
                (registration_id, workspace_id, Jsonb(workspace)),
            )


def create_submission_record(
    *,
    submission_id: UUID,
    registration_id: UUID,
    student_name: str,
    study_group: str,
    question_id: str,
    source_code: str,
    language: str,
    feedback_format: str,
) -> dict[str, Any]:
    """Create one immutable code attempt and allocate its per-question number."""
    initialize_database()
    attempt_key = f"{registration_id}:{question_id}"

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
            # this participant/question pair prevents both clicks receiving the same
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
                WHERE registration_id = %s AND question_id = %s
                """,
                (registration_id, question_id),
            )
            attempt_number = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO submissions (
                    submission_id,
                    registration_id,
                    student_name,
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
                    registration_id,
                    student_name,
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
    registration_id: UUID,
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

    initialize_database()
    assignments.append("updated_at = NOW()")
    values.extend((submission_id, registration_id))
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                UPDATE submissions
                SET {', '.join(assignments)}
                WHERE submission_id = %s AND registration_id = %s
                """,
                values,
            )
            return cursor.rowcount == 1
