"""Test the real SDK/AgentScope stream using an in-memory HTTP transport."""
import json
import unittest
from unittest.mock import patch

import httpx
import openai
from agentscope.message import UserMsg

from model_config import ModelSpec, build_model
from model_stream import stream_model_response


class ResponseBody(httpx.AsyncByteStream):
    def __init__(self, terminal):
        self.terminal = terminal
        self.closed = False
        self.read = 0

    async def __aiter__(self):
        events = [
            {"type": "response.reasoning_summary_text.delta", "delta": "private summary"},
            {"type": "response.output_text.delta", "delta": '{"student":'},
            {"type": "response.output_text.delta", "delta": '"中文😀"}'},
        ]
        if self.terminal:
            events.append({"type": self.terminal, "response": {
                "id": "resp_test", "status": "completed" if self.terminal == "response.completed" else "incomplete",
                "output": [], "usage": {"input_tokens": 5, "output_tokens": 9, "total_tokens": 14},
            }})
        for event in events:
            self.read += 1
            yield f'data: {json.dumps(event)}\n\n'.encode()

    async def aclose(self):
        self.closed = True


class ResponsesTests(unittest.TestCase):
    def setup_stream(self, terminal="response.completed"):
        body = ResponseBody(terminal)
        requests = []
        clients = []
        sdk_client = openai.AsyncClient

        def handle(request):
            self.assertEqual(request.url.path, "/v1/responses")
            requests.append(json.loads(request.content))
            return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=body)

        def factory():
            client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
            clients.append(client)
            def construct(**kwargs):
                return sdk_client(**kwargs, http_client=client)
            with patch("openai.AsyncClient", side_effect=construct):
                return build_model(ModelSpec("openai", "gpt-5.6-sol", "test-only",
                                            "https://mock.invalid/v1"), stream=True)

        return stream_model_response(factory, [UserMsg(name="user", content="test")]), body, requests, clients

    def test_incremental_text_parameters_usage_and_cleanup(self):
        stream, body, requests, clients = self.setup_stream()
        self.assertEqual(json.loads(next(stream))["type"], "start")
        first = json.loads(next(stream))
        self.assertEqual(first, {"type": "delta", "text": '{"student":'})
        self.assertEqual(body.read, 2)
        events = [first] + [json.loads(e) for e in stream]
        self.assertEqual(''.join(e.get("text", "") for e in events), '{"student":"中文😀"}')
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(events[-1]["usage"]["output_tokens"], 9)
        self.assertEqual(len(requests), 1)
        payload = requests[0]
        self.assertTrue(payload["stream"])
        self.assertEqual(payload["model"], "gpt-5.6-sol")
        self.assertEqual(payload["reasoning"], {"effort": "none", "mode": "standard", "summary": "auto"})
        self.assertEqual(payload["text"], {"format": {"type": "text"}, "verbosity": "medium"})
        self.assertTrue(payload["store"])
        self.assertEqual(payload["include"], ["reasoning.encrypted_content", "web_search_call.action.sources"])
        self.assertTrue(payload["input"])
        self.assertFalse(payload.get("tools"))
        self.assertTrue(body.closed)
        self.assertTrue(clients[0].is_closed)

    def test_incomplete_failed_and_missing_completion_never_publish_done(self):
        for terminal in ("response.incomplete", "response.failed", "error", None):
            with self.subTest(terminal=terminal):
                stream, body, requests, clients = self.setup_stream(terminal)
                events = [json.loads(e) for e in stream]
                self.assertEqual(events[-1]["type"], "error")
                self.assertNotIn("done", [e["type"] for e in events])
                self.assertEqual(len(requests), 1)
                self.assertTrue(body.closed)
                self.assertTrue(clients[0].is_closed)

    def test_cancel_closes_sdk_and_stops_reading(self):
        stream, body, _, clients = self.setup_stream()
        next(stream)
        next(stream)
        stream.close()
        self.assertEqual(body.read, 2)
        self.assertTrue(body.closed)
        self.assertTrue(clients[0].is_closed)
