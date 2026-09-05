"""Resolve which model a request may use, and with whose credentials.

A request arrives in one of two modes:

*Research mode* — the request carries the study password.  It is checked here,
server-side, against ``RESEARCH_PASSWORD``, and only then are the server's own
provider credentials used.  Checking the password in the browser would not be a
control at all: the API is public, so anyone could call it directly and spend
the study's quota.

*Bring-your-own-key mode* — the request carries a provider, model, key, and
optional base URL.  Those credentials are used for that single request and are
never logged or stored.

Both modes end at the same place: a configured ``ChatModelBase``.  AgentScope
gives every provider the same constructor and lets a credential name its own
model class, so supporting another provider is one entry in ``PROVIDERS``.
"""

from __future__ import annotations

import hmac
import ipaddress
import os
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

from agentscope.credential import CredentialFactory
from agentscope.model import ChatModelBase, DashScopeChatModel

# Providers offered to students. Every one of these credentials takes the same
# `api_key` + optional `base_url` pair, which is what keeps `build_model`
# provider-agnostic. Adding a provider whose credential is shaped differently
# (Ollama uses `host`, xAI uses `api_host`, Gemini has no base URL) would need a
# field mapping here as well.
PROVIDERS: dict[str, dict[str, str]] = {
    "openai": {
        "credential_type": "openai_credential",
        "label": "OpenAI",
        "example_model": "gpt-4o",
    },
    "dashscope": {
        "credential_type": "dashscope_credential",
        "label": "DashScope (Qwen)",
        "example_model": "qwen3-max",
    },
    "anthropic": {
        "credential_type": "anthropic_credential",
        "label": "Anthropic",
        "example_model": "claude-sonnet-4-5",
    },
    "deepseek": {
        "credential_type": "deepseek_credential",
        "label": "DeepSeek",
        "example_model": "deepseek-chat",
    },
}

MAX_FIELD_LENGTH = 2048


class ModelConfigError(Exception):
    """The request's model configuration is malformed (HTTP 400)."""


class AuthenticationError(Exception):
    """No usable credential: wrong password, or nothing supplied (HTTP 401)."""


@dataclass(frozen=True)
class ModelSpec:
    """One request's provider, model, and credential.

    `api_key` is secret: keep it out of logs, error messages, and responses.
    """

    provider: str
    model: str
    api_key: str
    base_url: str | None = None
    # True when the server is paying, which is worth knowing at the call site
    # even though both modes are otherwise handled identically.
    research_mode: bool = False

    def __repr__(self) -> str:
        """Mask the key, so an accidental log line or traceback cannot leak it."""
        return (
            f"ModelSpec(provider={self.provider!r}, model={self.model!r}, "
            f"api_key='***', base_url={self.base_url!r}, "
            f"research_mode={self.research_mode!r})"
        )


def _clean(value, field: str, *, required: bool = True) -> str | None:
    if value is None or value == "":
        if required:
            raise ModelConfigError(f'Missing required field: "{field}".')
        return None
    if not isinstance(value, str):
        raise ModelConfigError(f'Field "{field}" must be a string.')
    text = value.strip()
    if not text:
        if required:
            raise ModelConfigError(f'Field "{field}" must not be empty.')
        return None
    if len(text) > MAX_FIELD_LENGTH:
        raise ModelConfigError(f'Field "{field}" is too long.')
    return text


def _validate_base_url(url: str) -> str:
    """Reject base URLs that point back into the deployment's own network.

    A student-supplied base URL makes the backend issue a request to an address
    the student chose, so without this check the public API doubles as a proxy
    for probing Render's internal network and cloud metadata endpoints. DNS is
    resolved here to catch a public hostname that maps to a private address;
    this is a meaningful barrier, not an airtight one (the name could resolve
    differently when the request is actually made).
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ModelConfigError("Base URL must start with http:// or https://.")
    if not parsed.hostname:
        raise ModelConfigError("Base URL must include a host.")

    try:
        resolved = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as error:
        raise ModelConfigError("Base URL host could not be resolved.") from error

    for entry in resolved:
        address = ipaddress.ip_address(entry[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
        ):
            raise ModelConfigError(
                "Base URL must point at a public address."
            )
    return url


def _research_spec() -> ModelSpec:
    """The server's own credential, used once the password has been accepted."""
    api_key = os.getenv("API_KEY", "").strip()
    base_url = os.getenv("BASE_URL", "").strip()
    model = os.getenv("MODEL", "").strip()
    provider = os.getenv("PROVIDER", "").strip().lower()
    if not api_key or not base_url or not model or not provider:
        raise AuthenticationError(
            "The shared research model is not configured on this server."
        )
    if provider not in PROVIDERS:
        raise AuthenticationError(
            f'Unsupported research PROVIDER: "{provider}". '
            f'Choose one of: {", ".join(sorted(PROVIDERS))}.'
        )
    return ModelSpec(
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url,
        research_mode=True,
    )


def password_matches(candidate) -> bool:
    """Compare against RESEARCH_PASSWORD in constant time.

    An unset RESEARCH_PASSWORD disables research mode rather than accepting
    every request, so a missing environment variable cannot silently open the
    server's credentials to the public.
    """
    expected = os.getenv("RESEARCH_PASSWORD", "")
    if not expected or not isinstance(candidate, str) or not candidate:
        return False
    return hmac.compare_digest(candidate, expected)


def resolve_model_spec(config) -> ModelSpec:
    """Turn a request's `modelConfig` block into a usable `ModelSpec`."""
    if config is None:
        raise AuthenticationError(
            "Provide the research password or your own model credentials."
        )
    if not isinstance(config, dict):
        raise ModelConfigError('"modelConfig" must be a JSON object.')

    # Research mode takes precedence: if a password was sent, it must be right.
    password = config.get("password")
    if password not in (None, ""):
        if not password_matches(password):
            raise AuthenticationError("Incorrect research password.")
        return _research_spec()

    provider = _clean(config.get("provider"), "provider")
    if provider not in PROVIDERS:
        raise ModelConfigError(
            f'Unsupported provider: "{provider}". '
            f"Choose one of: {', '.join(sorted(PROVIDERS))}."
        )
    base_url = _clean(config.get("baseUrl"), "baseUrl", required=False)
    return ModelSpec(
        provider=provider,
        model=_clean(config.get("model"), "model"),
        api_key=_clean(config.get("apiKey"), "apiKey"),
        base_url=_validate_base_url(base_url) if base_url else None,
        research_mode=False,
    )


def build_model(spec: ModelSpec, *, stream: bool = False) -> ChatModelBase:
    """Construct the AgentScope chat model described by `spec`.

    The credential names its own model class, so this stays the same shape for
    every provider in `PROVIDERS`.
    """
    payload: dict[str, object] = {
        "type": PROVIDERS[spec.provider]["credential_type"],
        "api_key": spec.api_key,
    }
    if spec.base_url:
        payload["base_url"] = spec.base_url

    credential = CredentialFactory.from_dict(payload)
    model_class = credential.get_chat_model_class()

    kwargs: dict[str, object] = {
        "credential": credential,
        "model": spec.model,
        "stream": stream,
        # Keep transport retries in one place (the frontend). AgentScope and
        # the provider SDK must not multiply one student action into many
        # hidden upstream attempts.
        "max_retries": 0,
        "client_kwargs": {"max_retries": 0, "timeout": 120.0},
    }
    # `parameters` is provider-specific; only DashScope's thinking toggle is
    # set here, and every other provider keeps its own defaults.
    if model_class is DashScopeChatModel:
        kwargs["parameters"] = DashScopeChatModel.Parameters(thinking_enable=False)

    return model_class(**kwargs)


def public_providers() -> list[dict[str, str]]:
    """The provider catalogue the settings panel renders. No secrets."""
    return [
        {
            "id": key,
            "label": value["label"],
            "exampleModel": value["example_model"],
        }
        for key, value in PROVIDERS.items()
    ]
