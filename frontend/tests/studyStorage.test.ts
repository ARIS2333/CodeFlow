import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCompleteParticipantProfile } from '../src/lib/studyStorage.ts';

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
