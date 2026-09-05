import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from agentscope.message import TextBlock

import app as backend_app


class FakeModel:
    """Stops the size tests short of a live provider call."""

    model = "test-model"

    def __init__(self):
        self.client = SimpleNamespace(close=self._close)

    async def _close(self):
        pass

    async def __call__(self, messages):
        return SimpleNamespace(content=[TextBlock(text="ok")], usage=None)


BYOK = {"provider": "openai", "model": "gpt-4o", "apiKey": "sk-test"}

# Comfortably over MAX_CONTENT_LENGTH without building a huge string in memory.
OVERSIZED = "x" * (3 * 1024 * 1024)


class RequestSizeLimitTests(unittest.TestCase):
    """A body larger than the cap must be refused before it can exhaust a worker.

    These tests exist because the 413 handlers were previously unreachable:
    the handlers were written, but MAX_CONTENT_LENGTH was never set, so
    Werkzeug never raised RequestEntityTooLarge and nothing was ever rejected.
    """

    def setUp(self):
        self.client = backend_app.app.test_client()

    def test_the_cap_is_configured_at_all(self):
        self.assertEqual(
            backend_app.app.config["MAX_CONTENT_LENGTH"], 2 * 1024 * 1024
        )

    def test_every_post_endpoint_refuses_an_oversized_body(self):
        for path in (
            "/api/resource",
            "/api/resource/stream",
            "/api/analyze-code",
            "/api/verify-config",
        ):
            with self.subTest(path=path):
                response = self.client.post(
                    path,
                    data=json.dumps({"message": OVERSIZED}),
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 413)

    def test_the_413_is_json_rather_than_an_html_error_page(self):
        """RequestEntityTooLarge is not a BadRequest subclass, so the stream
        endpoint has to catch it explicitly or Flask renders HTML."""
        response = self.client.post(
            "/api/resource/stream",
            data=json.dumps({"message": OVERSIZED}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 413)
        self.assertIn("application/json", response.content_type)
        self.assertEqual(response.get_json()["error"], "Request is too large")

    def test_a_realistic_request_is_nowhere_near_the_cap(self):
        """The cap must not be able to reject ordinary classroom use."""
        realistic = {
            "message": json.dumps({
                "practice": {"title": "t", "description": "d" * 4_000, "examples": [], "constraints": []},
                "language": "java",
                "code": "public int f(int n) { return n; }\n" * 60,
            }),
            "system_message": "s" * 12_000,
            "modelConfig": BYOK,
        }
        body = json.dumps(realistic)
        self.assertLess(len(body), 100 * 1024)

        with patch.object(backend_app, "build_model", return_value=FakeModel()):
            response = self.client.post(
                "/api/resource", data=body, content_type="application/json"
            )
        # Reaches the model call rather than being refused for its size.
        self.assertEqual(response.status_code, 200)

    def test_an_oversized_prompt_under_the_cap_is_still_refused_per_endpoint(self):
        """The byte cap and the character check are separate guards."""
        response = self.client.post(
            "/api/resource",
            json={
                "message": "m" * 600_000,
                "system_message": "s" * 600_000,
                "modelConfig": BYOK,
            },
        )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(
            json.loads(response.get_json()["body"])["error"], "Request is too large"
        )


if __name__ == "__main__":
    unittest.main()
