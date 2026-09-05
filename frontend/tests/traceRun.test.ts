import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runTrace, selectTraceCase, type TraceState } from '../src/lib/traceRun.ts';
import type { TestResult } from '../src/lib/llmSchemas.ts';
import { traceGraphs, traceReply } from './traceFixtures.ts';
import { controlledStream, streamResponse } from './streamFixtures.ts';

/** These tests never reach a provider; the backend contract just requires a
 * model to be named on every LLM request. */
const TEST_MODEL_CONFIG = { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' } as const;


const result = (input: string, yourOutput: string, expected = '3'): TestResult =>
  ({ input, expected, yourOutput });

const request = (observedOutput?: string) => ({
  practice: { title: 'Sum', description: '', examples: [], constraints: [] },
  language: 'java' as const,
  code: 'int f(int a, int b) { return a > b ? a : b; }',
  graphs: traceGraphs(),
  testCase: { input: 'f(3, 3)', expected: '6', ...(observedOutput ? { observedOutput } : {}) },
});

test('a failing case is preferred, because that is where the two runs differ', () => {
  const chosen = selectTraceCase([
    result('f(1, 2)', '✅ 3'),
    result('f(9, 9)', '❌ 9'),
    result('f(4, 5)', '✅ 9'),
  ]);
  assert.deepEqual(chosen, { input: 'f(9, 9)', expected: '3', observedOutput: '❌ 9' });
});

test('the shortest failing input wins, since a short walk is the one a student reads', () => {
  const chosen = selectTraceCase([
    result('f(100, 200, 300)', '❌ 0'),
    result('f(1, 2)', '❌ 0'),
  ]);
  assert.equal(chosen?.input, 'f(1, 2)');
});

test('code that did not compile is never traced', () => {
  assert.equal(selectTraceCase([
    result('f(1, 2)', '❌ Compile Error'),
    result('f(3, 4)', '❌ Compile Error'),
  ]), null);
  assert.equal(selectTraceCase([]), null);
  // A compile error alongside a real run does not disqualify the run.
  assert.equal(selectTraceCase([
    result('f(1, 2)', '❌ Compile Error'),
    result('f(3, 4)', '❌ 7'),
  ])?.input, 'f(3, 4)');
});

test('an all-passing run still gets a trace, as a confirmation of the path taken', () => {
  const chosen = selectTraceCase([result('f(1, 2)', '✅ 3'), result('f(4, 5)', '✅ 9')]);
  assert.equal(chosen?.input, 'f(1, 2)');
});

test('each side is published as soon as it arrives, without waiting for the other', async (t) => {
  const stream = controlledStream();
  let fetched!: () => void;
  const requested = new Promise<void>((resolve) => { fetched = resolve; });
  t.mock.method(globalThis, 'fetch', async () => { fetched(); return stream.response; });

  const states: TraceState[] = [];
  const reply = traceReply();
  const finished = runTrace(request(), (state) => states.push(state), TEST_MODEL_CONFIG);
  await requested;
  assert.equal(states[0]?.status, 'loading');

  stream.send({ type: 'delta', text: `{"student":${JSON.stringify(reply.student)}` });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const partial = states.at(-1);
  assert.equal(partial?.status, 'loading');
  assert.equal(partial?.status === 'loading' && partial.progress?.student?.steps.length, 4);
  assert.equal(partial?.status === 'loading' && partial.progress?.llm, undefined);

  stream.send({ type: 'delta', text: `,"llm":${JSON.stringify(reply.llm)}}` });
  stream.send({ type: 'done' });
  stream.close();
  await finished;

  const last = states.at(-1);
  assert.equal(last?.status, 'success');
  assert.equal(last?.status === 'success' && last.data.student.steps[1].branch, 'false');
});

test('a trace that ends somewhere else than the test run is flagged, not hidden', async (t) => {
  const reply = traceReply();
  reply.student.finalOutput = '3';
  t.mock.method(globalThis, 'fetch', async () =>
    streamResponse([{ type: 'delta', text: JSON.stringify(reply) }, { type: 'done' }]));

  const states: TraceState[] = [];
  await runTrace(request('❌ 5'), (state) => states.push(state), TEST_MODEL_CONFIG);
  const last = states.at(-1);
  assert.equal(last?.status, 'success');
  assert.match(last?.status === 'success' ? last.warning ?? '' : '', /ends with 3, but running the code reported 5/);
});

test('a trace that agrees with the test run carries no caveat', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    streamResponse([{ type: 'delta', text: JSON.stringify(traceReply()) }, { type: 'done' }]));

  const states: TraceState[] = [];
  await runTrace(request('❌ 3'), (state) => states.push(state), TEST_MODEL_CONFIG);
  const last = states.at(-1);
  assert.equal(last?.status === 'success' && last.warning, undefined);
});

test('a cancelled trace never publishes over whatever replaced it', async (t) => {
  const stream = controlledStream();
  const controller = new AbortController();
  stream.abortOn(controller.signal);
  t.mock.method(globalThis, 'fetch', async () => stream.response);

  const states: TraceState[] = [];
  const finished = runTrace(request(), (state) => states.push(state), TEST_MODEL_CONFIG, controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await finished;
  assert.ok(states.every((state) => state.status === 'loading'), 'no late success or error');
});

test('a model that cannot produce a navigable trace ends as an error, not a broken player', async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    // Node "9" exists in neither graph, so no attempt can be highlighted.
    return streamResponse([
      { type: 'delta', text: JSON.stringify({ student: { steps: [{ nodeId: '9' }] }, llm: traceReply().llm }) },
      { type: 'done' },
    ]);
  });

  const states: TraceState[] = [];
  await runTrace(request(), (state) => states.push(state), TEST_MODEL_CONFIG);
  assert.equal(attempts, 2, 'the model is told what was wrong and asked once more');
  const last = states.at(-1);
  assert.equal(last?.status, 'error');
  assert.match(last?.status === 'error' ? last.error : '', /execution trace: the model returned an invalid format/);
});
