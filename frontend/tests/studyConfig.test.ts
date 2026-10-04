import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { STUDY_TASKS, STUDY_TASK_SET_VERSION, SURVEY_URLS, feedbackModeFor } from '../src/config/studyConfig.ts';
import { STUDY_SEQUENCE } from '../src/lib/studyStorage.ts';

test('both groups see the same four C++ tasks in the same order', () => {
  assert.deepEqual(STUDY_TASKS.map((task) => task.id), ['q1', 'q2', 'q3', 'q4']);
  assert.deepEqual(STUDY_TASKS.map((task) => task.kind), ['write', 'write', 'write', 'write']);
  assert.deepEqual(
    STUDY_TASKS.map((task) => task.problem.title),
    ['Unique Number', 'N-Sum: Two Sum', 'Find Digits', 'Hashing Mode'],
  );
  assert.equal(STUDY_TASK_SET_VERSION, 2);
  STUDY_TASKS.forEach((task) => {
    assert.match(task.starterCode, /Write your solution here\./);
  });
});

test('survey checkpoints remain part of the persistent study navigation', () => {
  assert.deepEqual(STUDY_SEQUENCE, ['s1', 'q1', 'q2', 's2', 'q3', 'q4', 's3', 's4', 'complete']);
  assert.match(SURVEY_URLS.s1, /SfnBvJ5kOvudcYIKuTYPA5dWsLU8nLCtMw8Z8kxMrmTmTF-yw/);
  assert.match(SURVEY_URLS.s2, /SfPnfhO-CQRNw4gtDBzVrslrce6sqcWl1qn3LC3Ncj-fhWZLA/);
  assert.equal(SURVEY_URLS.s3, SURVEY_URLS.s2);
  assert.match(SURVEY_URLS.s4, /SeQIKeT0k6yJ3VSFUvf4rXiCeoiBh5QQm4usFWe6Xj2i1_P9A/);
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
