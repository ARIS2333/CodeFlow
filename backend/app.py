import asyncio
import json
import os
from dataclasses import asdict
from uuid import uuid4

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from pydantic import SecretStr
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from agentscope.credential import DashScopeCredential
from agentscope.message import SystemMsg, UserMsg
from agentscope.model import ChatModelBase, DashScopeChatModel

import db
from code_analysis import CodeAnalysisError, analyze_code
from model_stream import create_stream_blueprint

load_dotenv()

MODEL_PROVIDER = os.getenv("MODEL_PROVIDER", "dashscope")


def build_model(*, stream: bool = False) -> ChatModelBase:
    """Construct the agentscope chat model for the configured provider.

    Every provider speaks the same ChatModelBase interface (called with a
    list of Msg, returns a ChatResponse or async response stream), so the rest of the app never
    touches provider-specific SDKs. Switching providers — or adding a new
    one (OpenAI, Anthropic, ...) — is just another branch here plus that
    provider's credential env vars.
    """
    if MODEL_PROVIDER == "dashscope":
        return DashScopeChatModel(
            credential=DashScopeCredential(
                api_key=SecretStr(os.environ["DASHSCOPE_API_KEY"]),
                base_url=(
                    f"https://{os.environ['DASHSCOPE_WORKSPACE_ID']}"
                    ".cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
                ),
            ),
            model=os.getenv("QWEN_MODEL", "qwen3.7-max"),
            parameters=DashScopeChatModel.Parameters(thinking_enable=False),
            stream=stream,
            # Keep transport retries in one place (the frontend). AgentScope and
            # the provider SDK must not multiply one student action into many
            # hidden upstream attempts.
            max_retries=0,
            client_kwargs={"max_retries": 0, "timeout": 120.0},
        )

    raise ValueError(f"Unsupported MODEL_PROVIDER: {MODEL_PROVIDER}")


app = Flask(__name__)
CORS(app)
app.register_blueprint(create_stream_blueprint(lambda: build_model(stream=True)))
# Returns each request's session to the pool. The engine itself stays lazy, so
# routes that do not touch the database still run without DATABASE_URL.
db.init_app(app)


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


async def call_model(system_message: str, user_message: str):
    # asyncio.run() creates and closes a loop for this request, so the model and
    # its pooled HTTP client must be created and closed inside that same loop.
    model = build_model()
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


@app.route("/api/analyze-code", methods=["POST"])
def analyze_code_resource():
    """Return deterministic, error-tolerant source facts for the flowchart LLM."""
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

        try:
            response, model_name = asyncio.run(call_model(system_message, user_message))
        except Exception as error:
            app.logger.exception("Model request failed (request %s)", g.request_id)
            return model_failure(error)

        response_content = extract_response_text(response.content)

        return jsonify({
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "response": response_content,
                "model": model_name,
                "usage": asdict(response.usage) if response.usage else {},
            }, ensure_ascii=False),
        })

    except (BadRequest, json.JSONDecodeError):
        return envelope_error("Invalid JSON in request body", 400)
    except RequestEntityTooLarge:
        return envelope_error("Request is too large", 413)
    except Exception:
        app.logger.exception("Unexpected request failure (request %s)", g.request_id)
        return envelope_error("Internal server error", 500)


if __name__ == "__main__":
    # Convenience server for local development only. Render uses Gunicorn.
    app.run(
        host=os.getenv("FLASK_HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5001")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
