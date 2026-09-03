import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CODE_ANALYSIS_URL } from '../src/config/apiConfig.ts';
import { requestReliableFlowchart } from '../src/lib/flowchartClient.ts';
import type { FlowchartProgress, FlowchartGenerationContext } from '../src/lib/flowchartGeneration.ts';
import { analysisStub, sampleGraph, missingPalindromeBrace } from './flowchartFixtures.ts';
import { controlledStream, streamResponse } from './streamFixtures.ts';

test('a suggestion and the student graph are observable while the same LLM response is still pending', async (t) => {
  const stream = controlledStream();
  let fetched!: () => void;
  const requested = new Promise<void>((resolve) => { fetched = resolve; });
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === CODE_ANALYSIS_URL) return Response.json(analysisStub('java', true));
    fetched();
    return stream.response;
  });
  let reportReady!: () => void;
  const report = new Promise<void>((resolve) => { reportReady = resolve; });
  let studentReady!: () => void;
  const student = new Promise<void>((resolve) => { studentReady = resolve; });
  const progress: FlowchartProgress[] = [];
  const contexts: FlowchartGenerationContext[] = [];
  let finished = false;
  const request = requestReliableFlowchart({ language: 'java', code: missingPalindromeBrace,
    practice: { title: '', description: '', constraints: [], examples: [] },
  }, (context) => { contexts.push(context); if (context.missingSymbols?.length) reportReady(); }, {
    onProgress: (part) => { progress.push(part); if (part.student) studentReady(); },
  }).then((result) => { finished = true; return result; });
  await requested;
  const suggestion = { symbol: '}', line: 10, anchor: 'return false;', placement: 'after', explanation: 'The if block may need a closing brace.' };
  stream.send({ type: 'delta', text: '{"missingSymbols":[' + JSON.stringify(suggestion) });
  await report;
  assert.equal(finished, false);
  assert.equal(progress.length, 1);
  assert.equal(contexts.at(-1)?.missingSymbols?.[0].location?.line, 10);
  stream.send({ type: 'delta', text: '],"student":' + JSON.stringify(sampleGraph().student) });
  await student;
  assert.equal(finished, false);
  assert.ok(progress.at(-1)?.student);
  assert.equal(progress.at(-1)?.llm, undefined);
  const studentObject = progress.at(-1)!.student;
  stream.send({ type: 'delta', text: ',"llm":' + JSON.stringify(sampleGraph().llm) + '}' });
  stream.send({ type: 'done' });
  const result = await request;
  assert.equal(result.student, studentObject, 'finalization must not rebuild the displayed student graph');
  assert.equal(result.llm, progress.at(-1)?.llm);
});

test('retries discard completed sections from the previous attempt instead of mixing them', async (t) => {
  const first = sampleGraph();
  first.llm.nodes[1].kind = 'process';
  const second = sampleGraph();
  second.student.nodes[1].data.label = 'different attempt';
  let attempt = 0;
  const progress: FlowchartProgress[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => url === CODE_ANALYSIS_URL
    ? Response.json(analysisStub('java', true))
    : streamResponse([{ type: 'delta', text: JSON.stringify(++attempt === 1 ? first : second) }, { type: 'done' }]));
  const result = await requestReliableFlowchart({ language: 'java', code: 'broken',
    practice: { title: '', description: '', constraints: [], examples: [] },
  }, undefined, { onProgress: (value) => progress.push(value) });
  assert.ok(progress.some((part) => part.attempt === 1 && part.student && !part.llm));
  assert.deepEqual(progress.find((part) => part.attempt === 2), { attempt: 2 });
  assert.equal(result.student.nodes[1].data.label, 'different attempt');
});

test('a grounded graph cannot be previewed without covering required source anchors', async (t) => {
  const progress: FlowchartProgress[] = [];
  let attempt = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => url === CODE_ANALYSIS_URL
    ? Response.json(analysisStub())
    : streamResponse([{ type: 'delta', text: JSON.stringify(sampleGraph(++attempt > 1)) }, { type: 'done' }]));
  await requestReliableFlowchart({ language: 'java', code: 'valid',
    practice: { title: '', description: '', constraints: [], examples: [] },
  }, undefined, { onProgress: (value) => progress.push(value) });
  assert.ok(progress.filter((part) => part.attempt === 1).every((part) => !part.student));
  assert.ok(progress.some((part) => part.attempt === 2 && part.student));
});
