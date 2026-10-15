import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { hasCompleteParticipantProfile, loadStudyProgress } from '../src/lib/studyStorage.ts';

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

test('participant profile requires every field before code can run', () => {
  const complete = {
    participantId: 'S1_001_G5XYP',
    group: 'A' as const,
  };

  assert.equal(hasCompleteParticipantProfile(complete), true);
  assert.equal(hasCompleteParticipantProfile({ ...complete, participantId: '  ' }), false);
  assert.equal(hasCompleteParticipantProfile(undefined), false);
});

test('older progress is discarded so the assigned participant ID must be verified again', () => {
  const legacy = JSON.stringify({
    version: 3,
    participant: {
      participantId: 'CF-P001',
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
  assert.equal(migrated.version, 4);
  assert.equal(migrated.currentScreen, 's1');
  assert.equal(migrated.furthestIndex, 0);
  assert.deepEqual(migrated.completedSurveys, []);
  assert.equal(migrated.participant, undefined);
  assert.ok(removed.includes('codeflow.study.progress.v3'));
  assert.ok(removed.includes('codeflow.researchPassword'));
});
