import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { consumeModelStream, requestJsonStream } from '../src/lib/llmStreamClient.ts';
import { streamResponse, controlledStream } from './streamFixtures.ts';

test('NDJSON frames and multibyte characters survive every single byte boundary', async () => {
  const encoded = new TextEncoder().encode(
    '\r\n' + JSON.stringify({ type: 'delta', text: '中文😀\n"{}"' }) + '\r\n' + JSON.stringify({ type: 'done' }) + '\n',
  );
  const body = new ReadableStream({ start(controller) {
    for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const texts: string[] = [];
  await consumeModelStream(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }), (text) => texts.push(text));
  assert.deepEqual(texts, ['中文😀\n"{}"']);
});

test('deltas reach the caller before completion and the done event releases the stream', async () => {
  const stream = controlledStream();
  let observed!: () => void;
  const ready = new Promise<void>((resolve) => { observed = resolve; });
  let settled = false;
  const pending = consumeModelStream(stream.response, () => observed()).then(() => { settled = true; });
  stream.send({ type: 'start' });
  stream.send({ type: 'ping' });
  stream.send({ type: 'delta', text: '{}' });
  await ready;
  assert.equal(settled, false);
  stream.send({ type: 'done' });
  await pending;
  assert.equal(stream.isCancelled(), true);
});

test('premature EOF and provider error frames never become successful completions', async () => {
  await assert.rejects(consumeModelStream(streamResponse([{ type: 'delta', text: '{}' }]), () => {}), /before model generation completed/);
  await assert.rejects(consumeModelStream(streamResponse([{ type: 'error', message: 'upstream failed' }]), () => {}), /upstream failed/);
});

test('invalid stream framing, MIME type, and HTTP errors are rejected', async () => {
  for (const response of [
    Response.json({}),
    new Response('', { status: 503 }),
    new Response('broken\n', { headers: { 'Content-Type': 'application/x-ndjson' } }),
    streamResponse([{ type: 'unknown' }]),
    streamResponse([{ type: 'done' }, { type: 'delta', text: 'late' }]),
  ]) await assert.rejects(consumeModelStream(response, () => {}));
});

test('transport interruption does not silently start a fresh paid generation', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return streamResponse([{ type: 'delta', text: '{"student":{}}' }]);
  });
  await assert.rejects(requestJsonStream({
    systemPrompt: '', message: '', label: 'test', onValue: () => {}, onAttempt: () => {},
    validate: (input) => ({ ok: true, value: input, repairs: [] }),
  }), /before model generation completed/);
  assert.equal(calls, 1);
});

test('invalid JSON is retried only after the stream ends, with a fresh parser', async (t) => {
  let calls = 0;
  const attempts: number[] = [];
  t.mock.method(globalThis, 'fetch', async () => streamResponse([
    { type: 'delta', text: ++calls === 1 ? '{"student":' : '{"student":{}}' }, { type: 'done' },
  ]));
  const result = await requestJsonStream({
    systemPrompt: '', message: '', label: 'test', onValue: () => {}, onAttempt: (attempt) => attempts.push(attempt),
    validate: (input) => ({ ok: true, value: input, repairs: [] }),
  });
  assert.deepEqual({ ...result as object }, { student: {} });
  assert.deepEqual(attempts, [1, 2]);
});

test('abort stops an in-flight read without triggering retry', async (t) => {
  const stream = controlledStream();
  const controller = new AbortController();
  let called!: () => void;
  const started = new Promise<void>((resolve) => { called = resolve; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls++;
    stream.abortOn(options.signal!);
    called();
    return stream.response;
  });
  const pending = requestJsonStream({
    systemPrompt: '', message: '', label: 'test', onValue: () => {}, onAttempt: () => {}, signal: controller.signal,
    validate: (input) => ({ ok: true, value: input, repairs: [] }),
  });
  const rejected = assert.rejects(pending, /abort/i);
  await started;
  controller.abort();
  await rejected;
  assert.equal(calls, 1);
});
