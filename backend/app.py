import asyncio
import json
import os
from dataclasses import asdict

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from pydantic import SecretStr

from agentscope.credential import DashScopeCredential
from agentscope.message import SystemMsg, UserMsg
from agentscope.model import ChatModelBase, DashScopeChatModel

load_dotenv()

MODEL_PROVIDER = os.getenv("MODEL_PROVIDER", "dashscope")


def build_model() -> ChatModelBase:
    """Construct the agentscope chat model for the configured provider.

    Every provider speaks the same ChatModelBase interface (called with a
    list of Msg, returns a ChatResponse), so the rest of the app never
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
            stream=False,
        )

    raise ValueError(f"Unsupported MODEL_PROVIDER: {MODEL_PROVIDER}")


model = build_model()

app = Flask(__name__)
CORS(app)


def extract_response_text(content_blocks) -> str:
    """Join the TextBlock content of a ChatResponse into a single string."""
    return "".join(
        block.text for block in content_blocks if hasattr(block, "text")
    )


async def call_model(system_message: str, user_message: str):
    messages = [
        SystemMsg(name="system", content=system_message),
        UserMsg(name="user", content=user_message),
    ]
    return await model(messages=messages)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


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

        user_message = body.get("message")
        if not user_message:
            return jsonify({
                "statusCode": 400,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
                "body": json.dumps({"error": "Missing required field: message"}),
            }), 400

        system_message = body.get("system_message", "You are a helpful assistant.")

        try:
            response = asyncio.run(call_model(system_message, user_message))
        except Exception as e:
            return jsonify({
                "statusCode": 502,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
                "body": json.dumps({
                    "error": f"{MODEL_PROVIDER} model request failed",
                    "details": str(e),
                }),
            }), 502

        response_content = extract_response_text(response.content)

        return jsonify({
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "response": response_content,
                "model": model.model,
                "usage": asdict(response.usage) if response.usage else {},
            }, ensure_ascii=False),
        })

    except json.JSONDecodeError as e:
        return jsonify({
            "statusCode": 400,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "error": "Invalid JSON in request body",
                "details": str(e),
            }),
        }), 400

    except Exception as e:
        return jsonify({
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "error": "Internal server error",
                "details": str(e),
            }),
        }), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
