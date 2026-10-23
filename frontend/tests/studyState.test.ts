import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCloudStudyState, saveCloudProgress, StudyAccountNotFoundError } from '../src/lib/studyState.ts';

const registrationId = '85d87357-c214-42e7-a4ed-741e374063a6';

test('cloud study state restores progress and question workspaces', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    progress: { currentScreen: 'q2', furthestIndex: 2, completedSurveys: ['s1'] },
    workspaces: { 'q1.v3': { version: 2, code: 'return true;' } },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    const state = await loadCloudStudyState(registrationId);
    assert.equal(state.progress?.currentScreen, 'q2');
    assert.equal(state.workspaces['q1.v3']?.code, 'return true;');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('progress sync sends only the navigation snapshot', async () => {
  const originalFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ saved: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await saveCloudProgress(registrationId, {
      currentScreen: 'q3',
      furthestIndex: 4,
      completedSurveys: ['s1', 's2'],
    });
    assert.deepEqual(body, {
      currentScreen: 'q3',
      furthestIndex: 4,
      completedSurveys: ['s1', 's2'],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a deleted server account is distinguished from a temporary load failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: 'Participant account was not found' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;
  try {
    await assert.rejects(
      () => loadCloudStudyState(registrationId),
      (error: unknown) => error instanceof StudyAccountNotFoundError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
