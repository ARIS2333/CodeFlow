import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  mergeTextualExecutionRegeneration,
  previousTextualLogicFrom,
  textualFeedbackSectionsFrom,
} from '../src/lib/textualFeedback.ts';

const original = `## Input used

\`f(1)\`

## Student's logic

Student logic stays fixed.

## Student's execution

Old student execution.

## Recommended logic

Recommended logic stays fixed.

## Recommended execution

Old recommended execution.`;

test('custom input regeneration preserves both original logic descriptions', () => {
  const logic = previousTextualLogicFrom(original);
  assert.deepEqual(logic, {
    student: 'Student logic stays fixed.',
    recommended: 'Recommended logic stays fixed.',
  });

  const merged = mergeTextualExecutionRegeneration(logic!, `## Input used

\`f(2)\`

## Student's execution

New student execution.

## Recommended execution

New recommended execution.`);

  assert.match(merged, /`f\(2\)`/);
  assert.match(merged, /Student logic stays fixed\./);
  assert.match(merged, /Recommended logic stays fixed\./);
  assert.match(merged, /New student execution\./);
  assert.match(merged, /New recommended execution\./);
  assert.doesNotMatch(merged, /Old student execution/);
});

test('partial retrace Markdown can be displayed while the response streams', () => {
  const logic = previousTextualLogicFrom(original)!;
  const merged = mergeTextualExecutionRegeneration(
    logic,
    '## Input used\n\n`f(3)`\n\n## Student\'s execution\n\n1. Start',
  );
  assert.match(merged, /`f\(3\)`/);
  assert.match(merged, /1\. Start/);
  assert.match(merged, /Recommended logic stays fixed\./);
});

test('textual feedback sections can be independently arranged by the UI', () => {
  assert.deepEqual(textualFeedbackSectionsFrom(original), {
    inputUsed: '`f(1)`',
    studentLogic: 'Student logic stays fixed.',
    studentExecution: 'Old student execution.',
    recommendedLogic: 'Recommended logic stays fixed.',
    recommendedExecution: 'Old recommended execution.',
  });
});

test('section extraction tolerates a partially streamed response', () => {
  const partial = textualFeedbackSectionsFrom(
    "## Input used\n\n`f(1)`\n\n## Student's logic\n\n1. Begin",
  );
  assert.equal(partial.inputUsed, '`f(1)`');
  assert.equal(partial.studentLogic, '1. Begin');
  assert.equal(partial.recommendedLogic, null);
});
