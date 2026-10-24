import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { multipleFunctionDefinitionMessage } from '../src/lib/codeAnalysis.ts';
import { analysisStub } from './flowchartFixtures.ts';

test('one function definition passes the study preflight', () => {
  const analysis = analysisStub('cpp');
  assert.equal(multipleFunctionDefinitionMessage(analysis), undefined);
});

test('multiple function definitions are named and rejected before feedback', () => {
  const analysis = analysisStub('cpp');
  analysis.functions = [
    analysis.functions[0],
    { ...analysis.functions[0], name: 'helper', startByte: 50, endByte: 80 },
  ];

  assert.equal(
    multipleFunctionDefinitionMessage(analysis),
    'Only one function definition is allowed for this exercise. Found 2: f, helper. '
      + 'Remove helper functions and keep only the function required by the problem.',
  );
});
