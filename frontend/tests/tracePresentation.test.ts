import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createTraceValidator } from '../src/lib/executionTrace.ts';
import { traceSourceReference, traceVariableChanges } from '../src/lib/tracePresentation.ts';
import { analysisStub, sampleGraph } from './flowchartFixtures.ts';
import { traceGraphs, traceReply } from './traceFixtures.ts';

test('state presentation shows only initial values and later changes', () => {
  const graphs = traceGraphs();
  const validated = createTraceValidator(graphs)(traceReply());
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  assert.deepEqual(traceVariableChanges(validated.value.student, 0), [
    { name: 'a', value: '3' },
    { name: 'b', value: '3' },
  ]);
  assert.deepEqual(traceVariableChanges(validated.value.student, 1), []);

  const changing = {
    ...validated.value.student,
    steps: [
      { ...validated.value.student.steps[0], variables: [{ name: 'i', value: '0' }] },
      { ...validated.value.student.steps[1], variables: [
        { name: 'i', value: '1' },
        { name: 'sum', value: '3' },
      ] },
    ],
  };
  assert.deepEqual(traceVariableChanges(changing, 1), [
    { name: 'i', previous: '0', value: '1' },
    { name: 'sum', value: '3' },
  ]);
});

test('a grounded student node resolves to source lines without guessing', () => {
  const graphs = sampleGraph(true);
  const analysis = analysisStub();
  const code = 'if (n > 0) {\n  return 1;\n}\nreturn 0;';
  assert.deepEqual(traceSourceReference(graphs.student, '2', analysis, code), {
    startLine: 1,
    endLine: 1,
    text: 'if (n > 0) {',
  });
  assert.equal(traceSourceReference(graphs.llm, '2', analysis, code), undefined);
  assert.equal(traceSourceReference(graphs.student, '404', analysis, code), undefined);
});
