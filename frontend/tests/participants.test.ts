import assert from 'node:assert/strict';
import test from 'node:test';

import { registerParticipant, updateParticipantName } from '../src/lib/participants.ts';

const registrationId = '85d87357-c214-42e7-a4ed-741e374063a6';

test('registration sends the name and stable browser token', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ registrationId, studentName: 'Ada Lovelace', group: 'A' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const registered = await registerParticipant(' Ada Lovelace ', registrationId, 'study-pass', 'register');
    assert.deepEqual(requestBody, {
      registrationId,
      studentName: ' Ada Lovelace ',
      password: 'study-pass',
      action: 'register',
    });
    assert.deepEqual(registered, { registrationId, studentName: 'Ada Lovelace', group: 'A' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an existing account can be resumed with its password', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ registrationId: 'existing-id', studentName: 'Ada Lovelace', group: 'B' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const registered = await registerParticipant('Ada Lovelace', registrationId, 'study-pass', 'login');
    assert.equal((requestBody as { action?: unknown }).action, 'login');
    assert.equal((requestBody as { password?: unknown }).password, 'study-pass');
    assert.equal(registered.registrationId, 'existing-id');
    assert.equal(registered.group, 'B');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registration shows the backend refusal reason', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: 'Student name is required' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;
  try {
    await assert.rejects(
      () => registerParticipant('', registrationId, 'study-pass', 'register'),
      /Student name is required/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a signed-in participant can update only their name', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody: unknown;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ registrationId, studentName: 'Grace Hopper', group: 'A' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const updated = await updateParticipantName(registrationId, 'Grace Hopper');
    assert.match(requestUrl, new RegExp(`/participants/${registrationId}/name$`));
    assert.deepEqual(requestBody, { studentName: 'Grace Hopper' });
    assert.deepEqual(updated, { registrationId, studentName: 'Grace Hopper', group: 'A' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
