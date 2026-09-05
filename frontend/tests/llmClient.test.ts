import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';
import { ApiRequestError, makeApiRequestWithRetry } from '../src/lib/llmClient.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const config = {
  url: 'https://example.test/api/resource',
  options: { method: 'POST' },
};

test('does not retry a malformed client request', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: 'Invalid JSON', requestId: 'request-1' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    makeApiRequestWithRetry(config, 2, 0, 1000),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 400);
      assert.equal(error.requestId, 'request-1');
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('retries a temporary server error but stops after success', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ error: 'Please retry' }), { status: 503 })
      : new Response('{}', { status: 200 });
  };

  const response = await makeApiRequestWithRetry(config, 2, 0, 1000);
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});
