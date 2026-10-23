import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { hasCompleteParticipantProfile, loadStudyProgress } from '../src/lib/studyStorage.ts';

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

test('participant profile requires every field before code can run', () => {
  const complete = {
    registrationId: '85d87357-c214-42e7-a4ed-741e374063a6',
    studentName: 'Ada Lovelace',
    group: 'A' as const,
  };

  assert.equal(hasCompleteParticipantProfile(complete), true);
  assert.equal(hasCompleteParticipantProfile({ ...complete, registrationId: '  ' }), false);
  assert.equal(hasCompleteParticipantProfile(undefined), false);
});

test('older progress is discarded so the student must register again', () => {
  const legacy = JSON.stringify({
    version: 3,
    participant: {
      registrationId: 'CF-P001',
      group: 'B',
    },
    currentScreen: 'q4',
    furthestIndex: 4,
    completedSurveys: ['mid1'],
  });
  const removed: string[] = [];
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => key === 'codeflow.study.progress.v3' ? legacy : null,
      removeItem: (key: string) => removed.push(key),
    },
  };

  const migrated = loadStudyProgress();
  assert.equal(migrated.version, 6);
  assert.equal(migrated.currentScreen, 's1');
  assert.equal(migrated.furthestIndex, 0);
  assert.deepEqual(migrated.completedSurveys, []);
  assert.equal(migrated.participant, undefined);
  assert.ok(removed.includes('codeflow.study.progress.v3'));
  assert.ok(removed.includes('codeflow.researchPassword'));
});
