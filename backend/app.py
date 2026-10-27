import asyncio
import hmac
import json
import os
from dataclasses import asdict
from uuid import UUID, uuid4

from dotenv import load_dotenv
from flask import Flask, Response, g, jsonify, request
from flask_cors import CORS
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from pydantic import SecretStr
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from agentscope.message import SystemMsg, UserMsg

from code_analysis import CodeAnalysisError, analyze_code
from cpp_execution_trace import CppTraceError, trace_pair
from database import (
    admin_study_summary,
    DatabaseNotConfigured,
    DuplicateStudentName,
    InvalidStudentLogin,
    create_submission_record,
    participant_registration,
    participant_usage_summary,
    participant_study_state,
    register_participant_record,
    save_participant_progress,
    save_participant_workspace,
    study_usage_summary,
    update_participant_name,
    update_submission_record,
)
from model_config import (
    AuthenticationError,
    ModelConfigError,
    ParticipantUsageLimitReached,
    ModelSpec,
    build_model,
    public_providers,
    resolve_model_spec,
)
from model_stream import create_stream_blueprint, stream_model_response
from textual_feedback import render_textual_feedback_prompt
from usage_tracking import usage_recorder

load_dotenv()


app = Flask(__name__)
# Reject an oversized body before Flask reads it into memory. Without this,
# `MAX_CONTENT_LENGTH` is unset, Werkzeug never raises RequestEntityTooLarge,
# and the 413 handlers below are unreachable — one large upload could exhaust a
# worker's memory and take every request sharing that worker down with it.
# A generous real request (long problem, parser facts, both graphs) is under
# 30 KB, so 2 MB leaves substantial headroom.
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
CORS(app)
app.register_blueprint(create_stream_blueprint())


@app.before_request
def assign_request_id():
    g.request_id = uuid4().hex


@app.after_request
def include_request_id(response):
    response.headers["X-Request-ID"] = g.get("request_id", "")
    return response


def public_error(message: str, status: int):
    """Small public error shape; internal exception details stay in logs."""
    return jsonify({
        "error": message,
        "requestId": g.get("request_id", ""),
    }), status


def envelope_error(message: str, status: int):
    return jsonify({
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({
            "error": message,
            "requestId": g.get("request_id", ""),
        }),
    }), status


def model_failure(error: Exception):
    """Preserve retryable provider status without exposing provider details."""
    status = getattr(error, "status_code", None)
    if status is None:
        response = getattr(error, "response", None)
        status = getattr(response, "status_code", None)
    if status == 429:
        public_response, response_status = envelope_error(
            "Model service is busy. Please retry shortly.", 429
        )
        provider_headers = getattr(getattr(error, "response", None), "headers", {}) or {}
        retry_after = provider_headers.get("Retry-After", "2")
        public_response.headers["Retry-After"] = retry_after
        return public_response, response_status
    if isinstance(error, TimeoutError) or "timeout" in type(error).__name__.lower():
        return envelope_error("Model request timed out. Please retry.", 504)
    return envelope_error("Model request failed. Please retry.", 502)


def extract_response_text(content_blocks) -> str:
    """Join the TextBlock content of a ChatResponse into a single string."""
    return "".join(
        block.text for block in content_blocks if hasattr(block, "text")
    )


async def call_model(spec: ModelSpec, system_message: str, user_message: str):
    # asyncio.run() creates and closes a loop for this request, so the model and
    # its pooled HTTP client must be created and closed inside that same loop.
    model = build_model(spec)
    messages = [
        SystemMsg(name="system", content=system_message),
        UserMsg(name="user", content=user_message),
    ]
    try:
        response = await model(messages=messages)
        return response, model.model
    finally:
        client = getattr(model, "client", None)
        if client is not None and hasattr(client, "close"):
            await client.close()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


def admin_signer():
    secret = os.getenv("ADMIN_PASSWORD", "")
    return URLSafeTimedSerializer(secret, salt="codeflow-admin-v1") if secret else None


@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    signer = admin_signer()
    if signer is None:
        return public_error("Admin access is not configured", 503)
    body = request.get_json(silent=True)
    password = body.get("password") if isinstance(body, dict) else None
    if not isinstance(password, str) or not hmac.compare_digest(
        password.encode(), os.getenv("ADMIN_PASSWORD", "").encode()
    ):
        return public_error("Incorrect admin password", 401)
    response = jsonify({"token": signer.dumps({"role": "admin"})})
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/admin/summary", methods=["GET"])
def admin_summary():
    signer = admin_signer()
    if signer is None:
        return public_error("Admin access is not configured", 503)
    authorization = request.headers.get("Authorization", "")
    try:
        if not authorization.startswith("Bearer "):
            return public_error("Admin login required", 401)
        identity = signer.loads(authorization[7:], max_age=4 * 60 * 60)
        if identity != {"role": "admin"}:
            return public_error("Admin login required", 401)
    except (BadSignature, SignatureExpired):
        return public_error("Admin session expired. Please sign in again.", 401)
    try:
        response = jsonify(admin_study_summary())
        response.headers["Cache-Control"] = "no-store"
        return response
    except DatabaseNotConfigured:
        return public_error("Study database is not configured", 503)
    except Exception:
        app.logger.exception("Admin summary failed (request %s)", g.request_id)
        return public_error("Study statistics could not be loaded", 500)


def resolve_registration(value: object) -> tuple[UUID, dict[str, str]] | None:
    if not isinstance(value, str):
        return None
    try:
        registration_id = UUID(value)
    except ValueError:
        return None
    registration = participant_registration(registration_id)
    return (registration_id, registration) if registration else None


@app.route("/api/participants/register", methods=["POST"])
def register_participant():
    """Persist a student's name and assign the next alternating condition."""
    try:
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            return public_error("Request body must be a JSON object", 400)
        student_name = body.get("studentName")
        if not isinstance(student_name, str):
            return public_error("Student name is required", 400)
        student_name = " ".join(student_name.split())
        if not student_name or len(student_name) > 100:
            return public_error("Student name must be between 1 and 100 characters", 400)
        password = body.get("password")
        if not isinstance(password, str) or not 4 <= len(password) <= 100:
            return public_error("Password must be between 4 and 100 characters", 400)
        action = body.get("action", "register")
        if action not in {"register", "login"}:
            return public_error("Invalid registration action", 400)
        try:
            registration_id = UUID(str(body.get("registrationId", "")))
        except ValueError:
            return public_error("Invalid registration ID", 400)
        return jsonify(register_participant_record(
            registration_id=registration_id,
            student_name=student_name,
            password=password,
            action=action,
        ))
    except InvalidStudentLogin as error:
        return public_error(str(error), 401)
    except DuplicateStudentName as error:
        return public_error(str(error), 409)
    except DatabaseNotConfigured:
        app.logger.exception("Study database is not configured")
        return public_error("Study registration is unavailable", 503)
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return public_error("Request is too large", 413)
    except Exception:
        app.logger.exception("Participant registration failed (request %s)", g.request_id)
        return public_error("Participant registration failed", 500)


@app.route("/api/participants/<registration_id>/name", methods=["PATCH"])
def change_participant_name(registration_id: str):
    """Let a signed-in participant correct their saved name."""
    try:
        try:
            parsed_registration_id = UUID(registration_id)
        except ValueError:
            return public_error("Invalid registration ID", 400)
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            return public_error("Request body must be a JSON object", 400)
        student_name = body.get("studentName")
        if not isinstance(student_name, str):
            return public_error("Student name is required", 400)
        student_name = " ".join(student_name.split())
        if not student_name or len(student_name) > 100:
            return public_error("Student name must be between 1 and 100 characters", 400)
        participant = update_participant_name(parsed_registration_id, student_name)
        if participant is None:
            return public_error("Participant account was not found", 404)
        return jsonify(participant)
    except DuplicateStudentName as error:
        return public_error(str(error), 409)
    except DatabaseNotConfigured:
        app.logger.exception("Study database is not configured")
        return public_error("Study registration is unavailable", 503)
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return public_error("Request is too large", 413)
    except Exception:
        app.logger.exception("Participant name update failed (request %s)", g.request_id)
        return public_error("Participant name could not be updated", 500)


def registered_participant_id(registration_id: str) -> UUID | None:
    """Parse and verify the browser-held registration token."""
    try:
        parsed = UUID(registration_id)
    except ValueError:
        return None
    return parsed if participant_registration(parsed) else None


@app.route("/api/participants/<registration_id>/usage", methods=["GET"])
def get_participant_usage(registration_id: str):
    """Return the participant's recorded AI spend and study allowance."""
    try:
        parsed = registered_participant_id(registration_id)
        if parsed is None:
            return public_error("Participant account was not found", 404)
        return jsonify(participant_usage_summary(parsed))
    except DatabaseNotConfigured:
        return public_error("Study database is unavailable", 503)
    except Exception:
        app.logger.exception("Usage lookup failed (request %s)", g.request_id)
        return public_error("AI usage could not be loaded", 500)


@app.route("/api/participants/<registration_id>/study-usage", methods=["GET"])
def get_study_usage(registration_id: str):
    """Return aggregate usage only to a participant with a valid account."""
    try:
        if registered_participant_id(registration_id) is None:
            return public_error("Participant account was not found", 404)
        return jsonify(study_usage_summary())
    except DatabaseNotConfigured:
        return public_error("Study database is unavailable", 503)
    except Exception:
        app.logger.exception("Study usage lookup failed (request %s)", g.request_id)
        return public_error("Study usage could not be loaded", 500)


@app.route("/api/participants/<registration_id>/state", methods=["GET"])
def get_participant_state(registration_id: str):
    """Restore progress, drafts, and latest generated feedback on another device."""
    try:
        parsed = registered_participant_id(registration_id)
        if parsed is None:
            return public_error("Participant account was not found", 404)
        return jsonify(participant_study_state(parsed))
    except DatabaseNotConfigured:
        return public_error("Study state is unavailable", 503)
    except Exception:
        app.logger.exception("Participant state load failed (request %s)", g.request_id)
        return public_error("Study state could not be loaded", 500)


@app.route("/api/participants/<registration_id>/progress", methods=["PUT"])
def put_participant_progress(registration_id: str):
    """Persist the participant's latest study-navigation snapshot."""
    try:
        parsed = registered_participant_id(registration_id)
        if parsed is None:
            return public_error("Participant account was not found", 404)
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            return public_error("Progress must be a JSON object", 400)
        screen = body.get("currentScreen")
        furthest = body.get("furthestIndex")
        completed = body.get("completedSurveys")
        valid_screens = {"s1", "q1", "q2", "s2", "q3", "q4", "s3", "s4", "complete"}
        if screen not in valid_screens or not isinstance(furthest, int) or not 0 <= furthest <= 8:
            return public_error("Invalid study progress", 400)
        if not isinstance(completed, list) or any(item not in {"s1", "s2", "s3", "s4"} for item in completed):
            return public_error("Invalid completed surveys", 400)
        snapshot = {
            "currentScreen": screen,
            "furthestIndex": furthest,
            "completedSurveys": list(dict.fromkeys(completed)),
        }
        save_participant_progress(parsed, snapshot)
        return jsonify({"saved": True})
    except DatabaseNotConfigured:
        return public_error("Study state is unavailable", 503)
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return public_error("Request is too large", 413)
    except Exception:
        app.logger.exception("Participant progress save failed (request %s)", g.request_id)
        return public_error("Study progress could not be saved", 500)


@app.route("/api/participants/<registration_id>/workspaces/<workspace_id>", methods=["PUT"])
def put_participant_workspace(registration_id: str, workspace_id: str):
    """Persist one question's latest code and generated-feedback workspace."""
    try:
        parsed = registered_participant_id(registration_id)
        if parsed is None:
            return public_error("Participant account was not found", 404)
        if workspace_id not in {"q1.v4", "q2.v4", "q3.v4", "q4.v4"}:
            return public_error("Invalid workspace", 400)
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict) or body.get("version") != 2:
            return public_error("Invalid workspace state", 400)
        save_participant_workspace(parsed, workspace_id, body)
        return jsonify({"saved": True})
    except DatabaseNotConfigured:
        return public_error("Study state is unavailable", 503)
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return public_error("Request is too large", 413)
    except Exception:
        app.logger.exception("Participant workspace save failed (request %s)", g.request_id)
        return public_error("Workspace could not be saved", 500)


@app.route("/api/submissions", methods=["POST"])
def create_submission_resource():
    """Record the code snapshot for one click of Run Code."""
    try:
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            return public_error("Request body must be a JSON object", 400)
        string_fields = (
            "submissionId",
            "registrationId",
            "questionId",
            "language",
            "feedbackFormat",
        )
        if any(
            not isinstance(body.get(field), str) or not body[field].strip()
            for field in string_fields
        ):
            return public_error("Missing submission fields", 400)
        if not isinstance(body.get("sourceCode"), str):
            return public_error("Missing submission fields", 400)

        try:
            submission_id = UUID(body["submissionId"])
        except (TypeError, ValueError):
            return public_error("Invalid submission ID", 400)

        registration = resolve_registration(body["registrationId"])
        if registration is None:
            return public_error("Invalid study registration", 401)
        registration_id, participant = registration
        if body["questionId"] not in {"q1", "q2", "q3", "q4"}:
            return public_error("Invalid question", 400)
        if body["feedbackFormat"] not in {"codeflow", "textual"}:
            return public_error("Invalid feedback format", 400)
        if body["language"] not in {"cpp", "python", "java"}:
            return public_error("Invalid language", 400)

        created = create_submission_record(
            submission_id=submission_id,
            registration_id=registration_id,
            student_name=participant["studentName"],
            study_group=participant["group"],
            question_id=body["questionId"],
            source_code=body["sourceCode"],
            language=body["language"],
            feedback_format=body["feedbackFormat"],
        )
        return jsonify(created), 201
    except DatabaseNotConfigured:
        app.logger.exception("Study database is not configured")
        return public_error("Study database is unavailable", 503)
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return public_error("Request is too large", 413)
    except Exception:
        app.logger.exception("Submission creation failed (request %s)", g.request_id)
        return public_error("Submission could not be saved", 500)


@app.route("/api/submissions/<uuid:submission_id>", methods=["PATCH"])
def update_submission_resource(submission_id):
    """Attach terminal and feedback workspace state to an existing attempt."""
    try:
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            return public_error("Request body must be a JSON object", 400)
        registration = resolve_registration(body.get("registrationId"))
        if registration is None:
            return public_error("Invalid study registration", 401)
        registration_id, _participant = registration

        allowed = {
            field: body[field]
            for field in (
                "terminalResult",
                "flowchart",
                "codeTrace",
                "textualFeedback",
            )
            if field in body
        }
        if not allowed:
            return public_error("No submission fields to update", 400)

        if not update_submission_record(submission_id, registration_id, allowed):
            return public_error("Submission not found", 404)
        return jsonify({"saved": True})
    except DatabaseNotConfigured:
        app.logger.exception("Study database is not configured")
        return public_error("Study database is unavailable", 503)
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return public_error("Request is too large", 413)
    except Exception:
        app.logger.exception("Submission update failed (request %s)", g.request_id)
        return public_error("Submission could not be updated", 500)


@app.route("/api/analyze-code", methods=["POST"])
def analyze_code_resource():
    """Return source facts and a deterministic, error-tolerant flowchart."""
    try:
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            raise CodeAnalysisError("Request body must be a JSON object.")

        language = body.get("language")
        code = body.get("code")
        if not isinstance(language, str):
            raise CodeAnalysisError('Missing required string field: "language".')
        if not isinstance(code, str):
            raise CodeAnalysisError('Missing required string field: "code".')

        return jsonify(analyze_code(language, code))
    except CodeAnalysisError as error:
        return jsonify({"error": str(error)}), 400
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return public_error("Request is too large", 413)
    except Exception:
        app.logger.exception("Code analysis failed (request %s)", g.request_id)
        return public_error("Code analysis failed", 500)


@app.route("/api/trace-cpp", methods=["POST"])
def trace_cpp_resource():
    """Return a real, instrumented execution trace for the fixed C++ tasks."""
    try:
        if os.getenv("ENABLE_NATIVE_CPP_TRACE", "").strip().lower() not in {
            "1", "true", "yes",
        }:
            return public_error("Native C++ tracing is not enabled", 503)
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            return public_error("Request body must be a JSON object", 400)
        # Native execution is more sensitive than parsing. Study deployments
        # must bind it to a registered participant rather than expose a public
        # compile-and-run endpoint.
        if os.getenv("DATABASE_URL", "").strip():
            if resolve_registration(body.get("registrationId")) is None:
                return public_error("Invalid study registration", 401)
        student_code = body.get("studentCode")
        recommended_code = body.get("recommendedCode")
        trace_input = body.get("input")
        if not all(isinstance(value, str) and value.strip() for value in (
            student_code, recommended_code, trace_input,
        )):
            return public_error(
                "studentCode, recommendedCode, and input are required", 400
            )
        return jsonify(trace_pair(student_code, recommended_code, trace_input))
    except CppTraceError as error:
        # A 422 tells the frontend that deterministic tracing was attempted but
        # this source shape is outside the bounded tracer. It may use the legacy
        # model trace without pretending the instrumented run succeeded.
        return public_error(str(error), 422)
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return public_error("Request is too large", 413)
    except Exception:
        app.logger.exception("C++ execution trace failed (request %s)", g.request_id)
        return public_error("C++ execution trace failed", 500)


@app.route("/api/providers", methods=["GET"])
def providers():
    """The provider catalogue the settings panel renders.

    Also reports whether this server has a research password configured at all,
    so the panel can hide that option on a deployment that only supports
    bring-your-own-key.
    """
    return jsonify({
        "providers": public_providers(),
        "researchModeAvailable": bool(os.getenv("RESEARCH_PASSWORD", "").strip()),
    })


@app.route("/api/verify-config", methods=["POST"])
def verify_config():
    """Check a settings-panel entry without spending a model call.

    This validates shape and, for research mode, the password. It deliberately
    does not call the provider, so a valid-looking but wrong API key is only
    discovered on the first real request.
    """
    try:
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            return public_error("Request body must be a JSON object", 400)
        spec = resolve_model_spec(body.get("modelConfig"))
    except AuthenticationError as error:
        return public_error(str(error), 401)
    except ParticipantUsageLimitReached as error:
        return public_error(str(error), 429)
    except ModelConfigError as error:
        return public_error(str(error), 400)
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)

    # Never echo the key back, not even masked.
    return jsonify({
        "ok": True,
        "provider": spec.provider,
        "model": spec.model,
        "researchMode": spec.research_mode,
    })


@app.route("/api/resource", methods=["POST"])
def resource():
    """
    Same request/response contract as the old Lambda so the frontend only
    needs its endpoint URL changed:
      request body:  { "message": str, "system_message"?: str }
      response body: { statusCode, headers, body: <json string> }
    """
    try:
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            return envelope_error("Request body must be a JSON object", 400)

        user_message = body.get("message")
        if not isinstance(user_message, str) or not user_message.strip():
            return envelope_error("Missing required string field: message", 400)

        system_message = body.get("system_message", "You are a helpful assistant.")
        if not isinstance(system_message, str):
            return envelope_error("system_message must be a string", 400)
        if len(user_message) + len(system_message) > 1_000_000:
            return envelope_error("Request is too large", 413)

        try:
            spec = resolve_model_spec(body.get("modelConfig"))
        except AuthenticationError as error:
            return envelope_error(str(error), 401)
        except ParticipantUsageLimitReached as error:
            return envelope_error(str(error), 429)
        except ModelConfigError as error:
            return envelope_error(str(error), 400)

        try:
            response, model_name = asyncio.run(
                call_model(spec, system_message, user_message)
            )
        except Exception as error:
            app.logger.exception("Model request failed (request %s)", g.request_id)
            return model_failure(error)

        response_content = extract_response_text(response.content)
        usage = asdict(response.usage) if response.usage else {}
        recorder = usage_recorder(
            body,
            provider=spec.provider,
            operation=str(body.get("usageOperation", "model request")),
            request_id=g.request_id,
        )
        if recorder is not None:
            recorder(model_name, usage)

        return jsonify({
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "response": response_content,
                "model": model_name,
                "usage": usage,
            }, ensure_ascii=False),
        })

    except (BadRequest, json.JSONDecodeError):
        return envelope_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return envelope_error("Request is too large", 413)
    except Exception:
        app.logger.exception("Unexpected request failure (request %s)", g.request_id)
        return envelope_error("Internal server error", 500)


@app.route("/api/textual-feedback/stream", methods=["POST"])
def textual_feedback_stream_resource():
    """Stream Markdown feedback using the researcher-authored study prompt."""
    try:
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, dict):
            return public_error("Request body must be a JSON object", 400)
        if body.get("language") != "cpp":
            return public_error("Textual study feedback currently requires C++", 400)
        code = body.get("code")
        problem = body.get("problem")
        execution_input = body.get("executionInput")
        previous_logic = body.get("previousLogic")
        if not isinstance(code, str) or not code.strip() or not isinstance(problem, dict):
            return public_error("Problem and code are required", 400)
        if execution_input is not None and (
            not isinstance(execution_input, str)
            or not execution_input.strip()
            or len(execution_input) > 2_000
        ):
            return public_error("Execution input must be non-empty text under 2,000 characters", 400)
        if previous_logic is not None and (
            not isinstance(previous_logic, dict)
            or set(previous_logic) != {"student", "recommended"}
            or any(
                not isinstance(previous_logic.get(key), str)
                or not previous_logic[key].strip()
                or len(previous_logic[key]) > 20_000
                for key in ("student", "recommended")
            )
        ):
            return public_error("Previous textual logic is invalid", 400)
        try:
            spec = resolve_model_spec(body.get("modelConfig"))
        except AuthenticationError as error:
            return public_error(str(error), 401)
        except ParticipantUsageLimitReached as error:
            return public_error(str(error), 429)
        except ModelConfigError as error:
            return public_error(str(error), 400)

        prompt = render_textual_feedback_prompt(
            problem,
            code,
            execution_input.strip() if execution_input else None,
            previous_logic,
        )
        messages = [UserMsg(name="user", content=prompt)]
        request_factory = lambda: build_model(spec, stream=True)
        recorder = usage_recorder(
            body,
            provider=spec.provider,
            operation="textual retrace" if previous_logic else "textual feedback",
            request_id=g.request_id,
        )
        return Response(
            stream_model_response(request_factory, messages, on_usage=recorder),
            content_type="application/x-ndjson; charset=utf-8",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )
    except (BadRequest, json.JSONDecodeError):
        return public_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return public_error("Request is too large", 413)
    except Exception as error:
        app.logger.exception("Textual feedback failed (request %s)", g.request_id)
        return model_failure(error)


if __name__ == "__main__":
    # Convenience server for local development only. Render uses Gunicorn.
    app.run(
        host=os.getenv("FLASK_HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5001")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
