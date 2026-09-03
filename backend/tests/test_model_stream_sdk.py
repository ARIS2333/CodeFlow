"""Exercise the installed AgentScope adapter with HTTP mocked below the SDK."""

import json
import unittest

import httpx
from pydantic import SecretStr
from agentscope.credential import DashScopeCredential
from agentscope.message import UserMsg
from agentscope.model import DashScopeChatModel

from model_stream import stream_model_response


class SSEBody(httpx.AsyncByteStream):
    def __init__(self, fail=False):
        self.closed = False
        self.parts_read = 0
        self.fail = fail

    async def __aiter__(self):
        for index, text in enumerate(['{"student":', '"中文😀"}']):
            event = {
                "id": "mock-response", "object": "chat.completion.chunk",
                "created": 1, "model": "test-model",
                "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
            }
            self.parts_read += 1
            yield f'data: {json.dumps(event, ensure_ascii=False)}\n\n'.encode()
            if self.fail and index == 0:
                raise httpx.ReadError('mock interrupted connection')
        yield b'data: {"id":"mock-response","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
        yield b'data: {"id":"mock-response","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":9,"total_tokens":14}}\n\n'
        yield b'data: [DONE]\n\n'

    async def aclose(self):
        self.closed = True


class ModelStreamSDKTests(unittest.TestCase):
    def setup_stream(self, fail=False):
        body = SSEBody(fail)
        requests = []
        clients = []

        def handle(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=body)

        def factory():
            client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
            clients.append(client)
            return DashScopeChatModel(
                credential=DashScopeCredential(api_key=SecretStr('test-only'), base_url='https://mock.invalid/v1'),
                model='test-model', stream=True, max_retries=0,
                parameters=DashScopeChatModel.Parameters(thinking_enable=False),
                client_kwargs={"http_client": client, "max_retries": 0},
            )

        stream = stream_model_response(factory, [UserMsg(name='user', content='test')])
        return stream, body, requests, clients

    def test_actual_sdk_forwards_deltas_before_completion_without_duplicating_snapshot(self):
        stream, body, requests, clients = self.setup_stream()
        self.assertEqual(json.loads(next(stream))['type'], 'start')
        self.assertEqual(requests, [])
        first = json.loads(next(stream))
        self.assertEqual(first, {'type': 'delta', 'text': '{"student":'})
        self.assertEqual(body.parts_read, 1, 'first delta must precede reading the remaining response')
        events = [first] + [json.loads(event) for event in stream]
        self.assertEqual(''.join(e.get('text', '') for e in events), '{"student":"中文😀"}')
        self.assertEqual(events[-1]['type'], 'done')
        self.assertEqual(events[-1]['usage']['output_tokens'], 9)
        self.assertEqual(len(requests), 1)
        self.assertTrue(requests[0]['stream'])
        self.assertFalse(requests[0]['enable_thinking'])
        self.assertTrue(body.closed)
        self.assertTrue(clients[0].is_closed)

    def test_actual_sdk_nested_response_closes_on_disconnect(self):
        stream, body, _, clients = self.setup_stream()
        next(stream)
        next(stream)
        stream.close()
        self.assertEqual(body.parts_read, 1)
        self.assertTrue(body.closed)
        self.assertTrue(clients[0].is_closed)

    def test_actual_sdk_read_error_stops_without_retry_or_done(self):
        stream, body, requests, clients = self.setup_stream(fail=True)
        events = [json.loads(event) for event in stream]
        self.assertEqual([e['type'] for e in events], ['start', 'delta', 'error'])
        self.assertEqual(len(requests), 1)
        self.assertTrue(body.closed)
        self.assertTrue(clients[0].is_closed)


if __name__ == '__main__':
    unittest.main()
