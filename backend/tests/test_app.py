import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from agentscope.message import TextBlock

import app as backend_app


class FakeModel:
    model = "test-model"

    def __init__(self, *, error=None):
        self.error = error
        self.closed = False
        self.client = SimpleNamespace(close=self.close)

    async def close(self):
        self.closed = True

    async def __call__(self, messages):
        if self.error:
            raise self.error
        return SimpleNamespace(
            content=[TextBlock(text="ok")],
            usage=None,
        )


class AppTests(unittest.TestCase):
    def setUp(self):
        self.client = backend_app.app.test_client()

    def test_each_request_owns_and_closes_its_model_client(self):
        models = [FakeModel(), FakeModel()]
        with patch.object(backend_app, "build_model", side_effect=models):
            responses = [
                self.client.post("/api/resource", json={"message": "hello"})
                for _ in range(2)
            ]

        self.assertEqual([response.status_code for response in responses], [200, 200])
        self.assertTrue(all(model.closed for model in models))
        self.assertEqual(
            json.loads(responses[0].get_json()["body"])["model"],
            "test-model",
        )

    def test_model_error_is_logged_but_not_returned_to_the_caller(self):
        model = FakeModel(error=RuntimeError("secret provider detail"))
        with patch.object(backend_app, "build_model", return_value=model):
            response = self.client.post("/api/resource", json={"message": "hello"})

        self.assertEqual(response.status_code, 502)
        self.assertNotIn("secret provider detail", response.get_data(as_text=True))
        self.assertIn("requestId", json.loads(response.get_json()["body"]))
        self.assertTrue(model.closed)

    def test_provider_rate_limit_remains_retryable_without_leaking_details(self):
        error = RuntimeError("private quota detail")
        error.status_code = 429
        with patch.object(backend_app, "build_model", return_value=FakeModel(error=error)):
            response = self.client.post("/api/resource", json={"message": "hello"})

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["Retry-After"], "2")
        self.assertNotIn("private quota detail", response.get_data(as_text=True))

    def test_invalid_json_and_invalid_fields_are_client_errors(self):
        malformed = self.client.post(
            "/api/resource", data="{", content_type="application/json"
        )
        invalid_field = self.client.post(
            "/api/resource", json={"message": "hello", "system_message": 1}
        )

        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(invalid_field.status_code, 400)
        self.assertIn("X-Request-ID", malformed.headers)

    def test_analyze_code_internal_error_is_sanitized(self):
        with patch.object(
            backend_app,
            "analyze_code",
            side_effect=RuntimeError("private parser detail"),
        ):
            response = self.client.post(
                "/api/analyze-code", json={"language": "python", "code": "pass"}
            )

        self.assertEqual(response.status_code, 500)
        self.assertNotIn("private parser detail", response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
