import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { hasCompleteParticipantProfile, loadStudyProgress } from '../src/lib/studyStorage.ts';

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

test('participant profile requires every field before code can run', () => {
  const complete = {
    participantId: 'CF-P001',
    group: 'A' as const,
  };

  assert.equal(hasCompleteParticipantProfile(complete), true);
  assert.equal(hasCompleteParticipantProfile({ ...complete, participantId: '  ' }), false);
  assert.equal(hasCompleteParticipantProfile(undefined), false);
});

test('legacy progress containing private fields is discarded', () => {
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
  const removed: string[] = [];
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => key === 'codeflow.study.progress.v2' ? legacy : null,
      removeItem: (key: string) => removed.push(key),
    },
  };

  const migrated = loadStudyProgress();
  assert.equal(migrated.version, 3);
  assert.equal(migrated.currentScreen, 's1');
  assert.equal(migrated.furthestIndex, 0);
  assert.deepEqual(migrated.completedSurveys, []);
  assert.equal(migrated.participant, undefined);
  assert.ok(removed.includes('codeflow.study.progress.v2'));
  assert.ok(removed.includes('codeflow.researchPassword'));
});
