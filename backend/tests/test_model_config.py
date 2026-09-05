import os
import unittest
from unittest.mock import patch

import app as backend_app
import model_config


RESEARCH_ENV = {
    "RESEARCH_PASSWORD": "test-research-password",
    "API_KEY": "sk-server-side",
    "BASE_URL": "https://workspace-1.example.com/v1",
    "MODEL": "qwen3.7-max",
    "PROVIDER": "dashscope",
}


class ResearchModeTests(unittest.TestCase):
    """The password is what stands between the public API and the study's quota."""

    def test_the_right_password_unlocks_the_servers_own_credential(self):
        with patch.dict(os.environ, RESEARCH_ENV, clear=False):
            spec = model_config.resolve_model_spec({"password": "test-research-password"})

        self.assertTrue(spec.research_mode)
        self.assertEqual(spec.provider, "dashscope")
        self.assertEqual(spec.model, "qwen3.7-max")
        self.assertEqual(spec.api_key, "sk-server-side")
        self.assertEqual(spec.base_url, "https://workspace-1.example.com/v1")

    def test_research_mode_supports_any_configured_provider(self):
        env = {
            **RESEARCH_ENV,
            "PROVIDER": "openai",
            "MODEL": "gpt-4o",
            "BASE_URL": "https://api.openai.com/v1",
        }
        with patch.dict(os.environ, env, clear=False):
            spec = model_config.resolve_model_spec({"password": "test-research-password"})

        self.assertEqual(spec.provider, "openai")
        self.assertEqual(spec.model, "gpt-4o")
        self.assertEqual(spec.base_url, "https://api.openai.com/v1")

    def test_incomplete_research_configuration_is_rejected(self):
        for missing in ("API_KEY", "BASE_URL", "MODEL", "PROVIDER"):
            with self.subTest(missing=missing):
                with patch.dict(os.environ, {**RESEARCH_ENV, missing: ""}, clear=False):
                    with self.assertRaises(model_config.AuthenticationError):
                        model_config.resolve_model_spec(
                            {"password": "test-research-password"}
                        )

    def test_unsupported_research_provider_lists_valid_choices(self):
        with patch.dict(
            os.environ, {**RESEARCH_ENV, "PROVIDER": "unsupported"}, clear=False
        ):
            with self.assertRaises(model_config.AuthenticationError) as caught:
                model_config.resolve_model_spec(
                    {"password": "test-research-password"}
                )

        message = str(caught.exception)
        self.assertIn("Unsupported research PROVIDER", message)
        for provider in ("openai", "dashscope", "anthropic", "deepseek"):
            self.assertIn(provider, message)

    def test_a_wrong_password_is_rejected_rather_than_falling_back_to_byok(self):
        with patch.dict(os.environ, RESEARCH_ENV, clear=False):
            with self.assertRaises(model_config.AuthenticationError):
                model_config.resolve_model_spec({
                    "password": "wrong",
                    # A caller must not be able to smuggle themselves past a
                    # failed password by also sending their own provider.
                    "provider": "openai",
                    "model": "gpt-4o",
                    "apiKey": "sk-x",
                })

    def test_an_unset_password_disables_research_mode_instead_of_opening_it(self):
        """A missing env var must not mean 'everyone gets the server's key'."""
        with patch.dict(os.environ, {"RESEARCH_PASSWORD": ""}, clear=False):
            self.assertFalse(model_config.password_matches(""))
            self.assertFalse(model_config.password_matches("anything"))

    def test_no_credentials_at_all_is_unauthorized(self):
        with self.assertRaises(model_config.AuthenticationError):
            model_config.resolve_model_spec(None)


class ByokTests(unittest.TestCase):
    def test_each_supported_provider_builds_its_own_model_class(self):
        expected = {
            "openai": "OpenAIChatModel",
            "dashscope": "DashScopeChatModel",
            "anthropic": "AnthropicChatModel",
            "deepseek": "DeepSeekChatModel",
        }
        for provider, model_class in expected.items():
            with self.subTest(provider=provider):
                spec = model_config.resolve_model_spec({
                    "provider": provider, "model": "some-model", "apiKey": "sk-x",
                })
                built = model_config.build_model(spec)
                self.assertEqual(type(built).__name__, model_class)
                self.assertEqual(built.model, "some-model")
                # The frontend owns retries; the SDK must not multiply one
                # student action into several upstream attempts.
                self.assertEqual(built.max_retries, 0)

    def test_an_unsupported_provider_is_a_client_error(self):
        with self.assertRaises(model_config.ModelConfigError):
            model_config.resolve_model_spec({
                "provider": "gemini", "model": "x", "apiKey": "k",
            })

    def test_missing_fields_name_the_field(self):
        for missing in ("provider", "model", "apiKey"):
            payload = {"provider": "openai", "model": "gpt-4o", "apiKey": "sk-x"}
            del payload[missing]
            with self.subTest(missing=missing):
                with self.assertRaises(model_config.ModelConfigError) as caught:
                    model_config.resolve_model_spec(payload)
                self.assertIn(missing, str(caught.exception))


class BaseUrlTests(unittest.TestCase):
    """A student-chosen base URL makes the backend fetch an address they picked."""

    def _resolve(self, base_url):
        return model_config.resolve_model_spec({
            "provider": "openai", "model": "m", "apiKey": "k", "baseUrl": base_url,
        })

    def test_a_public_https_endpoint_is_accepted(self):
        self.assertEqual(
            self._resolve("https://api.openai.com/v1").base_url,
            "https://api.openai.com/v1",
        )

    def test_addresses_inside_the_deployment_are_refused(self):
        for blocked in (
            "http://127.0.0.1:5001/v1",      # the backend itself
            "http://localhost:5001/v1",
            "http://169.254.169.254/latest",  # cloud metadata
            "http://10.0.0.5/v1",             # private network
            "http://[::1]/v1",
        ):
            with self.subTest(base_url=blocked):
                with self.assertRaises(model_config.ModelConfigError):
                    self._resolve(blocked)

    def test_non_http_schemes_are_refused(self):
        for blocked in ("file:///etc/passwd", "gopher://example.com/"):
            with self.subTest(base_url=blocked):
                with self.assertRaises(model_config.ModelConfigError):
                    self._resolve(blocked)

    def test_an_omitted_base_url_leaves_the_provider_default(self):
        spec = model_config.resolve_model_spec({
            "provider": "deepseek", "model": "deepseek-chat", "apiKey": "k",
        })
        self.assertIsNone(spec.base_url)
        self.assertEqual(
            model_config.build_model(spec).credential.base_url,
            "https://api.deepseek.com",
        )


class SecretHandlingTests(unittest.TestCase):
    def test_the_api_key_is_masked_in_representations(self):
        """A spec can reach a log line or traceback; the key must not."""
        spec = model_config.ModelSpec(
            provider="openai", model="gpt-4o", api_key="sk-VERY-SECRET",
        )
        for rendered in (repr(spec), str(spec), f"{spec}"):
            self.assertNotIn("VERY-SECRET", rendered)

    def test_verify_config_never_echoes_the_key_back(self):
        client = backend_app.app.test_client()
        response = client.post("/api/verify-config", json={
            "modelConfig": {
                "provider": "openai", "model": "gpt-4o", "apiKey": "sk-VERY-SECRET",
            },
        })

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("VERY-SECRET", response.get_data(as_text=True))
        self.assertEqual(response.get_json()["provider"], "openai")


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = backend_app.app.test_client()

    def test_the_catalogue_lists_the_four_providers_and_no_secrets(self):
        with patch.dict(os.environ, RESEARCH_ENV, clear=False):
            response = self.client.get("/api/providers")

        payload = response.get_json()
        self.assertEqual(
            sorted(p["id"] for p in payload["providers"]),
            ["anthropic", "dashscope", "deepseek", "openai"],
        )
        self.assertTrue(payload["researchModeAvailable"])
        self.assertNotIn("sk-server-side", response.get_data(as_text=True))

    def test_the_catalogue_reports_research_mode_off_when_unconfigured(self):
        with patch.dict(os.environ, {"RESEARCH_PASSWORD": ""}, clear=False):
            payload = self.client.get("/api/providers").get_json()

        self.assertFalse(payload["researchModeAvailable"])

    def test_verify_config_separates_a_bad_password_from_a_bad_shape(self):
        with patch.dict(os.environ, RESEARCH_ENV, clear=False):
            wrong_password = self.client.post(
                "/api/verify-config", json={"modelConfig": {"password": "nope"}}
            )
        bad_shape = self.client.post(
            "/api/verify-config", json={"modelConfig": {"provider": "openai"}}
        )

        self.assertEqual(wrong_password.status_code, 401)
        self.assertEqual(bad_shape.status_code, 400)

    def test_verify_config_reports_valid_research_providers(self):
        with patch.dict(
            os.environ, {**RESEARCH_ENV, "PROVIDER": "unsupported"}, clear=False
        ):
            response = self.client.post(
                "/api/verify-config",
                json={"modelConfig": {"password": "test-research-password"}},
            )

        self.assertEqual(response.status_code, 401)
        message = response.get_json()["error"]
        self.assertIn("Unsupported research PROVIDER", message)
        for provider in ("openai", "dashscope", "anthropic", "deepseek"):
            self.assertIn(provider, message)

    def test_the_stream_endpoint_is_gated_too(self):
        """The streaming path must not be an unauthenticated way in."""
        response = self.client.post(
            "/api/resource/stream", json={"message": "hello"}
        )

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
