"""Regression coverage for the SDK's default httpx2/httpcore2 transport."""

import contextlib
import io
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from agentscope.credential import DashScopeCredential
from agentscope.message import UserMsg
from agentscope.model import DashScopeChatModel
from pydantic import SecretStr

from model_stream import stream_model_response


class _SSEHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        events = [
            {
                "id": "mock-response",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "test-model",
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": '{"ok":true}'},
                        "finish_reason": None,
                    }
                ],
            },
            {
                "id": "mock-response",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "test-model",
                "choices": [
                    {"index": 0, "delta": {}, "finish_reason": "stop"}
                ],
            },
            {
                "id": "mock-response",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "test-model",
                "choices": [],
                "usage": {
                    "prompt_tokens": 2,
                    "completion_tokens": 3,
                    "total_tokens": 5,
                },
            },
        ]
        body = b"".join(
            f"data: {json.dumps(event)}\n\n".encode() for event in events
        ) + b"data: [DONE]\n\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def log_message(self, *args):
        pass


class DefaultTransportStreamTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _SSEHandler)
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            daemon=True,
        )
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def factory(self):
        return DashScopeChatModel(
            credential=DashScopeCredential(
                api_key=SecretStr("test-only"),
                base_url=f"http://127.0.0.1:{self.server.server_port}/v1",
            ),
            model="test-model",
            stream=True,
            max_retries=0,
            parameters=DashScopeChatModel.Parameters(thinking_enable=False),
            client_kwargs={"max_retries": 0},
        )

    def test_normal_completion_does_not_leave_async_generator_errors(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            events = [
                json.loads(item)
                for item in stream_model_response(
                    self.factory,
                    [UserMsg(name="user", content="test")],
                )
            ]

        self.assertEqual(events[-1]["type"], "done")
        self.assertNotIn("generator didn't stop after athrow()", stderr.getvalue())
        self.assertNotIn("Task was destroyed", stderr.getvalue())

    def test_disconnect_does_not_leave_async_generator_errors(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            stream = stream_model_response(
                self.factory,
                [UserMsg(name="user", content="test")],
            )
            self.assertEqual(json.loads(next(stream))["type"], "start")
            self.assertEqual(json.loads(next(stream))["type"], "delta")
            stream.close()

        self.assertNotIn("generator didn't stop after athrow()", stderr.getvalue())
        self.assertNotIn("Task was destroyed", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
