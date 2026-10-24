import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createTraceValidator } from '../src/lib/executionTrace.ts';
import {
  orderedTraceVariables,
  traceSourceReference,
  traceVariableChanges,
} from '../src/lib/tracePresentation.ts';
import { analysisStub, sampleGraph } from './flowchartFixtures.ts';
import { traceGraphs, traceReply } from './traceFixtures.ts';

test('state presentation shows only initial values and later changes', () => {
  const graphs = traceGraphs();
  const validated = createTraceValidator(graphs)(traceReply());
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  assert.deepEqual(traceVariableChanges(validated.value.student, 0), [
    { name: 'a', value: '3', kind: 'new' },
    { name: 'b', value: '3', kind: 'new' },
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
    { name: 'i', previous: '0', value: '1', kind: 'changed' },
    { name: 'sum', value: '3', kind: 'new' },
  ]);
});

test('map changes identify only the entry that changed', () => {
  const trace = {
    steps: [
      { nodeId: '1', note: '', variables: [{ name: 'freq', value: '{1: 1}' }] },
      { nodeId: '2', note: '', variables: [{ name: 'freq', value: '{1: 1, 3: 1}' }] },
      { nodeId: '2', note: '', variables: [{ name: 'freq', value: '{1: 1, 3: 2}' }] },
    ],
    finalOutput: '',
    truncated: false,
  };
  assert.deepEqual(traceVariableChanges(trace, 1), [
    { name: 'freq[3]', value: '1', kind: 'new' },
  ]);
  assert.deepEqual(traceVariableChanges(trace, 2), [
    { name: 'freq[3]', previous: '1', value: '2', kind: 'changed' },
  ]);
});

test('variable cards retain first-seen order even if a later event is reordered', () => {
  const trace = {
    steps: [
      { nodeId: '1', note: '', variables: [
        { name: 'nums', value: '[2, 1]' },
        { name: 'target', value: '3' },
      ] },
      { nodeId: '2', note: '', variables: [
        { name: 'i', value: '0' },
        { name: 'target', value: '3' },
        { name: 'nums', value: '[2, 1]' },
      ] },
    ],
    finalOutput: '',
    truncated: false,
  };
  assert.deepEqual(orderedTraceVariables(trace, 1).map(({ name }) => name), [
    'nums', 'target', 'i',
  ]);
});

test('array changes identify the exact index that changed', () => {
  const trace = {
    steps: [
      { nodeId: '1', note: '', variables: [
        { name: 'seen', value: '[false, false, false]' },
      ] },
      { nodeId: '2', note: '', variables: [
        { name: 'seen', value: '[false, true, false]' },
      ] },
    ],
    finalOutput: '',
    truncated: false,
  };
  assert.deepEqual(traceVariableChanges(trace, 1), [
    { name: 'seen[1]', previous: 'false', value: 'true', kind: 'changed' },
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
