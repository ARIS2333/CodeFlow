import assert from 'node:assert/strict';
import test from 'node:test';

import { loadParticipantUsage } from '../src/lib/participantUsage.ts';

test('participant usage loads the authoritative server total', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  globalThis.fetch = (async (input) => {
    requestUrl = String(input);
    return new Response(JSON.stringify({
      spentUsd: 0.25,
      limitUsd: 1,
      remainingUsd: 0.75,
      exhausted: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const usage = await loadParticipantUsage('registration-1');
    assert.match(requestUrl, /participants\/registration-1\/usage$/);
    assert.equal(usage.spentUsd, 0.25);
    assert.equal(usage.exhausted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('participant usage surfaces a server refusal', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: 'AI usage could not be loaded' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;
  try {
    await assert.rejects(
      () => loadParticipantUsage('registration-1'),
      /AI usage could not be loaded/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
