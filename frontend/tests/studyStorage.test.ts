import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { hasCompleteParticipantProfile, loadStudyProgress } from '../src/lib/studyStorage.ts';

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

test('participant profile requires every field before code can run', () => {
  const complete = {
    name: 'Alice Student',
    email: 'alice@example.com',
    group: 'A' as const,
    researchPassword: 'study-password',
  };

  assert.equal(hasCompleteParticipantProfile(complete), true);
  assert.equal(hasCompleteParticipantProfile({ ...complete, name: '  ' }), false);
  assert.equal(hasCompleteParticipantProfile({ ...complete, email: 'not-an-email' }), false);
  assert.equal(hasCompleteParticipantProfile({ ...complete, researchPassword: '' }), false);
  assert.equal(hasCompleteParticipantProfile(undefined), false);
});

test('legacy progress keeps participant information but restarts at required S1', () => {
  const legacy = JSON.stringify({
    version: 1,
    participant: {
      name: 'Alice Student',
      email: 'alice@example.com',
      group: 'B',
      researchPassword: 'study-password',
    },
    currentScreen: 'q4',
    furthestIndex: 4,
    completedSurveys: ['mid1'],
  });
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => key === 'codeflow.study.progress.v1' ? legacy : null,
    },
  };

  const migrated = loadStudyProgress();
  assert.equal(migrated.version, 2);
  assert.equal(migrated.currentScreen, 's1');
  assert.equal(migrated.furthestIndex, 0);
  assert.deepEqual(migrated.completedSurveys, []);
  assert.equal(migrated.participant?.email, 'alice@example.com');
});
