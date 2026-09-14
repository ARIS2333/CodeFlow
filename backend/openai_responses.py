"""Responses configuration and completion checks for CodeFlow's Sol model."""

from agentscope.model import OpenAIResponseModel


class CheckedResponseStream:
    """Preserve SDK cleanup while rejecting partial or unsuccessful responses."""

    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        self.stream = await self.response.__aenter__()
        return self

    async def __aexit__(self, *args):
        return await self.response.__aexit__(*args)

    async def __aiter__(self):
        completed = False
        async for event in self.stream:
            if event.type in {"error", "response.failed", "response.incomplete"}:
                raise RuntimeError("OpenAI response did not complete")
            if event.type == "response.completed":
                if event.response.status != "completed":
                    raise RuntimeError("OpenAI response did not complete")
                completed = True
            yield event
        if not completed:
            raise RuntimeError("OpenAI stream ended without completion")


class CodeFlowResponseModel(OpenAIResponseModel):
    async def _call_api(self, model_name, messages, tools=None, tool_choice=None,
                        **generate_kwargs):
        options = {
            "text": {"format": {"type": "text"}, "verbosity": "medium"},
            "reasoning": {"effort": "none", "mode": "standard", "summary": "auto"},
            "store": True,
            "include": ["reasoning.encrypted_content", "web_search_call.action.sources"],
        }
        options.update(generate_kwargs)
        return await super()._call_api(
            model_name, messages, tools=tools, tool_choice=tool_choice, **options,
        )

    async def _parse_stream_response(self, start_datetime, response):
        parsed = super()._parse_stream_response(
            start_datetime, CheckedResponseStream(response),
        )
        try:
            async for chunk in parsed:
                yield chunk
        finally:
            await parsed.aclose()

    def _parse_completion_response(self, start_datetime, response):
        if response.status != "completed":
            raise RuntimeError("OpenAI response did not complete")
        return super()._parse_completion_response(start_datetime, response)
