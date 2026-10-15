import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyParticipant } from '../src/lib/participants.ts';

test('participant verification returns the server-owned group assignment', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ participantId: 'S2_001_2WTLM', group: 'B' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const verified = await verifyParticipant('cf-p002');
    assert.deepEqual(requestBody, { participantId: 'cf-p002' });
    assert.deepEqual(verified, { participantId: 'S2_001_2WTLM', group: 'B' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('participant verification shows the backend refusal reason', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: 'Invalid participant ID' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;

  try {
    await assert.rejects(
      () => verifyParticipant('unknown'),
      /Invalid participant ID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
