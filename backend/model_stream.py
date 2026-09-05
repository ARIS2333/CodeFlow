"""Bridge AgentScope's async deltas to a cancellable Flask NDJSON response."""

import asyncio
import json
import time
from dataclasses import asdict

from flask import Blueprint, Response, jsonify, request
from werkzeug.exceptions import BadRequest
from agentscope.message import SystemMsg, UserMsg


def frame(event):
    return json.dumps(event, ensure_ascii=False) + "\n"


def text_content(response):
    # Do not forward thinking blocks, tool calls, or provider metadata as text.
    return "".join(block.text for block in response.content
                   if getattr(block, "type", None) == "text")


def stream_model_response(model_factory, messages, *, heartbeat=10, timeout=180):
    """Own the event loop, model client, and upstream iterator for this request.

    AgentScope 2 emits deltas followed by is_last=True containing the full text.
    Check that final snapshot, but never append it a second time. Heartbeats
    keep the response live and allow WSGI to notice disconnects while upstream
    is quiet. Disconnect/timeout closes the upstream request on the same loop.
    """
    loop = asyncio.new_event_loop()
    model = stream = pending = None
    deadline = time.monotonic() + timeout
    accumulated = ""

    async def start():
        nonlocal model
        model = model_factory()
        return await model(messages=messages)

    def wait_for(task):
        while not task.done():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Model stream timed out")
            completed, _ = loop.run_until_complete(asyncio.wait(
                {task}, timeout=min(heartbeat, remaining),
            ))
            if not completed:
                yield frame({"type": "ping"})

    try:
        # Send headers without waiting for the provider's first token.
        yield frame({"type": "start"})
        pending = loop.create_task(start())
        yield from wait_for(pending)
        stream = pending.result()
        if not hasattr(stream, "__anext__"):
            raise RuntimeError("Provider did not return a streaming response")

        while True:
            pending = loop.create_task(anext(stream))
            yield from wait_for(pending)
            try:
                chunk = pending.result()
            except StopAsyncIteration:
                raise RuntimeError("Model stream ended without a final response") from None
            text = text_content(chunk)
            if chunk.is_last:
                if len(text) > 2_000_000:
                    raise RuntimeError("Model response is too large")
                if str(chunk.finished_reason) != "completed":
                    raise RuntimeError("Model stream was interrupted")
                if not text.startswith(accumulated):
                    raise RuntimeError("Final model response did not match its streamed text")
                if len(text) > len(accumulated):
                    yield frame({"type": "delta", "text": text[len(accumulated):]})
                yield frame({
                    "type": "done",
                    "model": model.model,
                    "usage": asdict(chunk.usage) if chunk.usage else {},
                })
                break
            if text:
                accumulated += text
                if len(accumulated) > 2_000_000:
                    raise RuntimeError("Model response is too large")
                yield frame({"type": "delta", "text": text})
    except GeneratorExit:
        raise
    except Exception:
        # Do not send provider exception text, which can include request details.
        yield frame({"type": "error", "message": "Model stream failed or timed out. Please retry."})
    finally:
        if pending is not None and not pending.done():
            pending.cancel()
            loop.run_until_complete(asyncio.gather(pending, return_exceptions=True))
        try:
            if stream is not None and hasattr(stream, "aclose"):
                loop.run_until_complete(stream.aclose())
        finally:
            try:
                # Closing the outer SDK iterator may leave nested generators
                # pending. Let those release response bodies before the client.
                loop.run_until_complete(loop.shutdown_asyncgens())
            finally:
                try:
                    if model is not None and hasattr(model, "client"):
                        loop.run_until_complete(model.client.close())
                finally:
                    loop.close()


def create_stream_blueprint(model_factory):
    blueprint = Blueprint("model_stream", __name__)

    @blueprint.post("/api/resource/stream")
    def resource_stream():
        try:
            body = request.get_json(force=True, silent=False)
        except BadRequest:
            return jsonify({"error": "Invalid JSON in request body"}), 400
        if not isinstance(body, dict) or not isinstance(body.get("message"), str) or not body["message"].strip():
            return jsonify({"error": "Missing required string field: message"}), 400
        system = body.get("system_message", "You are a helpful assistant.")
        if not isinstance(system, str):
            return jsonify({"error": "system_message must be a string"}), 400
        if len(body["message"]) + len(system) > 1_000_000:
            return jsonify({"error": "Request is too large"}), 413
        messages = [SystemMsg(name="system", content=system), UserMsg(name="user", content=body["message"])]
        return Response(
            stream_model_response(model_factory, messages),
            content_type="application/x-ndjson; charset=utf-8",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    return blueprint
