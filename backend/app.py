import json
import os
from http import HTTPStatus

import dashscope
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

load_dotenv()

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")
DASHSCOPE_WORKSPACE_ID = os.getenv("DASHSCOPE_WORKSPACE_ID")
QWEN_MODEL = os.getenv("QWEN_MODEL", "qwen3.7-max")

dashscope.base_http_api_url = (
    f"https://{DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com/api/v1"
)

app = Flask(__name__)
CORS(app)


def extract_response_text(response):
    """Handle both plain-string content and multimodal content lists (e.g. [{'text': '...'}])."""
    content = response.output.choices[0].message.content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return content


def call_qwen(system_message: str, user_message: str):
    # qwen3.7-max is a text model served via the text-generation endpoint on
    # this workspace gateway, not the multimodal-generation one.
    messages = [
        {"role": "system", "content": system_message},
        {"role": "user", "content": user_message},
    ]
    return dashscope.Generation.call(
        api_key=DASHSCOPE_API_KEY,
        model=QWEN_MODEL,
        messages=messages,
        result_format="message",
        enable_thinking=False
    )


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

        response = call_qwen(system_message, user_message)

        if response.status_code != HTTPStatus.OK:
            return jsonify({
                "statusCode": response.status_code,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
                "body": json.dumps({
                    "error": "Qwen API request failed",
                    "code": response.code,
                    "details": response.message,
                }),
            }), 502

        response_content = extract_response_text(response)
        usage = getattr(response, "usage", None) or {}

        return jsonify({
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "response": response_content,
                "model": QWEN_MODEL,
                "usage": dict(usage) if usage else {},
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
