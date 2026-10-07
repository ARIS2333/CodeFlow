import assert from 'node:assert/strict';
import test from 'node:test';

import { createSubmission, updateSubmission } from '../src/lib/submissions.ts';

test('createSubmission sends one complete Run Code snapshot', async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = (async (input, init) => {
    captured = { url: String(input), init };
    return new Response(JSON.stringify({
      submissionId: '85d87357-c214-42e7-a4ed-741e374063a6',
      attemptNumber: 3,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const created = await createSubmission({
      participantId: 'CF-P001',
      questionId: 'q1',
      sourceCode: 'bool isNumUnique(int n) { return true; }',
      language: 'cpp',
      feedbackFormat: 'codeflow',
    });
    assert.equal(created.attemptNumber, 3);
    assert.match(captured.url ?? '', /\/api\/submissions$/);
    assert.equal(captured.init?.method, 'POST');
    const sent = JSON.parse(String(captured.init?.body));
    assert.match(sent.submissionId, /^[0-9a-f-]{36}$/);
    delete sent.submissionId;
    assert.deepEqual(sent, {
      participantId: 'CF-P001',
      questionId: 'q1',
      sourceCode: 'bool isNumUnique(int n) { return true; }',
      language: 'cpp',
      feedbackFormat: 'codeflow',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateSubmission attaches generated workspace state to the same record', async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = (async (input, init) => {
    captured = { url: String(input), init };
    return new Response(JSON.stringify({ saved: true }), { status: 200 });
  }) as typeof fetch;

  try {
    await updateSubmission('submission-id', 'CF-P001', {
      textualFeedback: { status: 'success', markdown: 'feedback' },
    });
    assert.match(captured.url ?? '', /\/api\/submissions\/submission-id$/);
    assert.equal(captured.init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(captured.init?.body)), {
      participantId: 'CF-P001',
      textualFeedback: { status: 'success', markdown: 'feedback' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
