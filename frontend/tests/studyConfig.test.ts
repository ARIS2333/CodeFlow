import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { STUDY_TASKS, feedbackModeFor } from '../src/config/studyConfig.ts';
import { STUDY_SEQUENCE } from '../src/lib/studyStorage.ts';

test('both groups see the same four C++ tasks in the same order', () => {
  assert.deepEqual(STUDY_TASKS.map((task) => task.id), ['q1', 'q2', 'q3', 'q4']);
  assert.deepEqual(STUDY_TASKS.map((task) => task.kind), ['write', 'debug', 'write', 'debug']);
});

test('survey checkpoints remain part of the persistent study navigation', () => {
  assert.deepEqual(STUDY_SEQUENCE, ['q1', 'q2', 'mid1', 'q3', 'q4', 'mid2', 'post', 'complete']);
});

test('feedback order is counterbalanced without binding tasks to one condition', () => {
  assert.equal(feedbackModeFor('A', 'q1'), 'codeflow');
  assert.equal(feedbackModeFor('A', 'q2'), 'codeflow');
  assert.equal(feedbackModeFor('A', 'q3'), 'textual');
  assert.equal(feedbackModeFor('B', 'q1'), 'textual');
  assert.equal(feedbackModeFor('B', 'q2'), 'textual');
  assert.equal(feedbackModeFor('B', 'q3'), 'codeflow');
  assert.equal(feedbackModeFor('B', 'q4'), 'codeflow');
});
