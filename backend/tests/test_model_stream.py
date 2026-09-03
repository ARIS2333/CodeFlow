import asyncio
import json
import unittest
from types import SimpleNamespace

from flask import Flask
from agentscope.message import TextBlock
from agentscope.model import ChatResponse, FinishedReason
from model_stream import create_stream_blueprint, stream_model_response


def chunk(text, final=False, reason=FinishedReason.COMPLETED):
    return ChatResponse(content=[TextBlock(text=text)], is_last=final, finished_reason=reason)


class FakeModel:
    model = "test-model"

    def __init__(self, chunks, delay=0):
        self.chunks = chunks
        self.delay = delay
        self.closed = False
        self.iterator_closed = False
        self.messages = None
        self.client = SimpleNamespace(close=self.close)

    async def close(self):
        self.closed = True

    async def __call__(self, messages):
        self.messages = messages

        async def generate():
            try:
                for entry in self.chunks:
                    if self.delay:
                        await asyncio.sleep(self.delay)
                    if isinstance(entry, Exception):
                        raise entry
                    yield entry
            finally:
                self.iterator_closed = True

        return generate()


class ModelStreamTests(unittest.TestCase):
    def events(self, model, **kwargs):
        return [json.loads(value) for value in stream_model_response(lambda: model, [], **kwargs)]

    def test_deltas_are_not_duplicated_by_the_final_accumulated_snapshot(self):
        model = FakeModel([chunk('{"text":'), chunk('"中文😀"}'), chunk('{"text":"中文😀"}', True)])
        events = self.events(model)
        self.assertEqual(''.join(e.get('text', '') for e in events), '{"text":"中文😀"}')
        self.assertEqual([e['type'] for e in events], ['start', 'delta', 'delta', 'done'])
        self.assertTrue(model.closed)
        self.assertTrue(model.iterator_closed)

    def test_final_snapshot_can_supply_a_missing_suffix(self):
        events = self.events(FakeModel([chunk('{'), chunk('{}', True)]))
        self.assertEqual(''.join(e.get('text', '') for e in events), '{}')

    def test_oversized_final_only_response_is_rejected_before_forwarding(self):
        events = self.events(FakeModel([chunk('x' * 2_000_001, True)]))
        self.assertEqual([e['type'] for e in events], ['start', 'error'])

    def test_disconnection_closes_upstream_iterator_and_client(self):
        model = FakeModel([chunk('a'), chunk('b'), chunk('ab', True)])
        stream = stream_model_response(lambda: model, [])
        self.assertEqual(json.loads(next(stream))['type'], 'start')
        self.assertEqual(json.loads(next(stream))['text'], 'a')
        stream.close()
        self.assertTrue(model.closed)
        self.assertTrue(model.iterator_closed)

    def test_quiet_upstream_emits_heartbeats_and_can_be_cancelled(self):
        model = FakeModel([chunk('{}', True)], delay=1)
        stream = stream_model_response(lambda: model, [], heartbeat=0.001)
        next(stream)
        self.assertEqual(json.loads(next(stream))['type'], 'ping')
        stream.close()
        self.assertTrue(model.closed)
        self.assertTrue(model.iterator_closed)

    def test_timeout_closes_resources_and_emits_error_not_done(self):
        model = FakeModel([chunk('{}', True)], delay=1)
        events = self.events(model, heartbeat=0.001, timeout=0.003)
        self.assertEqual(events[-1]['type'], 'error')
        self.assertNotIn('done', [e['type'] for e in events])
        self.assertTrue(model.closed)

    def test_errors_interrupted_or_inconsistent_snapshots_do_not_claim_completion(self):
        for chunks in [
            [chunk('a'), RuntimeError('sensitive provider details')],
            [chunk('a')],
            [chunk('a'), chunk('different', True)],
            [chunk('a'), chunk('a', True, FinishedReason.INTERRUPTED)],
        ]:
            with self.subTest(chunks=chunks):
                events = self.events(FakeModel(chunks))
                self.assertEqual(events[-1]['type'], 'error')
                self.assertNotIn('sensitive', json.dumps(events))

    def test_only_text_blocks_are_forwarded(self):
        hidden = ChatResponse(content=[SimpleNamespace(type='thinking', text='secret')], is_last=False)
        events = self.events(FakeModel([hidden, chunk('{}', True)]))
        self.assertNotIn('secret', json.dumps(events))

    def test_route_is_streaming_and_validates_requests_before_creating_a_model(self):
        model = FakeModel([chunk('{}'), chunk('{}', True)])
        created = []

        def factory():
            created.append(True)
            return model

        app = Flask(__name__)
        app.register_blueprint(create_stream_blueprint(factory))
        client = app.test_client()
        for body in [None, [], {}, {'message': ''}, {'message': 'x', 'system_message': 1}]:
            self.assertEqual(client.post('/api/resource/stream', json=body).status_code, 400)
        self.assertFalse(created)
        response = client.post('/api/resource/stream', json={'message': 'code', 'system_message': 'rules'}, buffered=False)
        self.assertEqual(response.mimetype, 'application/x-ndjson')
        self.assertEqual(response.headers['X-Accel-Buffering'], 'no')
        self.assertFalse(created, 'first frame must not wait on model creation')
        events = [json.loads(data) for data in response.response]
        self.assertEqual(events[-1]['type'], 'done')
        self.assertTrue(model.closed)


if __name__ == '__main__':
    unittest.main()
