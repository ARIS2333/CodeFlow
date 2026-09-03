import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  startAnalysisRun,
  type EvaluationState,
  type FlowchartState,
} from '../src/lib/analysisRun.ts';
import type { CodeEvaluationResponse, FlowchartData } from '../src/lib/llmSchemas.ts';

const evaluation: CodeEvaluationResponse = { IsCorrect: true, TestResults: [] };
const flowchart: FlowchartData = {
  student: { nodes: [], edges: [] },
  llm: { nodes: [], edges: [] },
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const setup = () => {
  const feedback = deferred<CodeEvaluationResponse>();
  const charts = deferred<FlowchartData>();
  const feedbackStates: EvaluationState[] = [];
  const flowchartStates: FlowchartState[] = [];
  const started: string[] = [];
  const run = startAnalysisRun({
    requestFeedback: () => {
      // Both panels must show loaders before either request starts.
      assert.equal(feedbackStates.at(-1)?.status, 'loading');
      assert.equal(flowchartStates.at(-1)?.status, 'loading');
      started.push('feedback');
      return feedback.promise;
    },
    requestFlowchart: () => {
      started.push('flowchart');
      return charts.promise;
    },
    onFeedbackChange: (state) => feedbackStates.push(state),
    onFlowchartChange: (state) => flowchartStates.push(state),
  });
  return { run, feedback, charts, feedbackStates, flowchartStates, started };
};

test('starts both requests and displays both loading states immediately', () => {
  const { run, feedbackStates, flowchartStates, started } = setup();
  assert.deepEqual(started, ['feedback', 'flowchart']);
  assert.deepEqual(feedbackStates, [{ status: 'loading' }]);
  assert.deepEqual(flowchartStates, [{ status: 'loading' }]);
  assert.equal(run.isRunning(), true);
  run.cancel();
});

test('feedback renders while the flowchart is still pending', async () => {
  const { run, feedback, charts, feedbackStates, flowchartStates } = setup();
  feedback.resolve(evaluation);
  await Promise.resolve();
  assert.deepEqual(feedbackStates.at(-1), { status: 'success', data: evaluation });
  assert.deepEqual(flowchartStates, [{ status: 'loading' }]);
  assert.equal(run.isRunning(), true);

  charts.resolve(flowchart);
  await Promise.resolve();
  assert.deepEqual(flowchartStates.at(-1), { status: 'success', data: flowchart });
  assert.equal(feedbackStates.length, 2);
  assert.equal(run.isRunning(), false);
});

test('flowchart renders while feedback is still pending', async () => {
  const { run, feedback, charts, feedbackStates, flowchartStates } = setup();
  charts.resolve(flowchart);
  await Promise.resolve();
  assert.deepEqual(flowchartStates.at(-1), { status: 'success', data: flowchart });
  assert.deepEqual(feedbackStates, [{ status: 'loading' }]);
  assert.equal(run.isRunning(), true);

  feedback.resolve(evaluation);
  await Promise.resolve();
  assert.deepEqual(feedbackStates.at(-1), { status: 'success', data: evaluation });
  assert.equal(flowchartStates.length, 2);
  assert.equal(run.isRunning(), false);
});

test('feedback errors appear immediately and do not block the flowchart', async () => {
  const { run, feedback, charts, feedbackStates, flowchartStates } = setup();
  feedback.reject(new Error('Feedback service unavailable'));
  await Promise.resolve();
  assert.deepEqual(feedbackStates.at(-1), {
    status: 'error', error: 'Feedback service unavailable',
  });
  assert.deepEqual(flowchartStates, [{ status: 'loading' }]);
  assert.equal(run.isRunning(), true);

  charts.resolve(flowchart);
  await Promise.resolve();
  assert.equal(flowchartStates.at(-1)?.status, 'success');
  assert.equal(feedbackStates.at(-1)?.status, 'error');
  assert.equal(run.isRunning(), false);
});

test('flowchart errors appear immediately and do not block feedback', async () => {
  const { run, feedback, charts, feedbackStates, flowchartStates } = setup();
  charts.reject(new Error('Parser or flowchart request failed'));
  await Promise.resolve();
  assert.deepEqual(flowchartStates.at(-1), {
    status: 'error', error: 'Parser or flowchart request failed',
  });
  assert.deepEqual(feedbackStates, [{ status: 'loading' }]);

  feedback.resolve(evaluation);
  await Promise.resolve();
  assert.equal(feedbackStates.at(-1)?.status, 'success');
  assert.equal(flowchartStates.at(-1)?.status, 'error');
  assert.equal(run.isRunning(), false);
});

test('a late failure does not overwrite the other task\'s completed result', async () => {
  const { run, feedback, charts, feedbackStates, flowchartStates } = setup();
  charts.resolve(flowchart);
  await Promise.resolve();
  feedback.reject(new Error('Feedback failed later'));
  await Promise.resolve();
  assert.deepEqual(flowchartStates.at(-1), { status: 'success', data: flowchart });
  assert.equal(flowchartStates.length, 2);
  assert.equal(feedbackStates.at(-1)?.status, 'error');
  assert.equal(run.isRunning(), false);
});

test('clear ignores late successes and failures from an in-flight run', async () => {
  const { run, feedback, charts, feedbackStates, flowchartStates } = setup();
  run.cancel();
  feedbackStates.push({ status: 'idle' });
  flowchartStates.push({ status: 'idle' });
  assert.equal(run.isRunning(), false);

  feedback.resolve(evaluation);
  charts.reject(new Error('Old failure'));
  await Promise.resolve();
  assert.deepEqual(feedbackStates, [{ status: 'loading' }, { status: 'idle' }]);
  assert.deepEqual(flowchartStates, [{ status: 'loading' }, { status: 'idle' }]);
});

test('a cancelled run cannot overwrite results from a new run', async () => {
  const old = setup();
  old.run.cancel();
  const nextFeedback = deferred<CodeEvaluationResponse>();
  const nextCharts = deferred<FlowchartData>();
  const nextRun = startAnalysisRun({
    requestFeedback: () => nextFeedback.promise,
    requestFlowchart: () => nextCharts.promise,
    onFeedbackChange: (state) => old.feedbackStates.push(state),
    onFlowchartChange: (state) => old.flowchartStates.push(state),
  });
  const nextEvaluation = { IsCorrect: false, TestResults: [] };
  nextFeedback.resolve(nextEvaluation);
  await Promise.resolve();

  old.feedback.resolve(evaluation);
  old.charts.resolve(flowchart);
  await Promise.resolve();
  assert.deepEqual(old.feedbackStates.at(-1), { status: 'success', data: nextEvaluation });
  assert.deepEqual(old.flowchartStates, [{ status: 'loading' }, { status: 'loading' }]);
  assert.equal(nextRun.isRunning(), true);

  nextCharts.resolve(flowchart);
  await Promise.resolve();
  assert.equal(nextRun.isRunning(), false);
});

test('a synchronous request error still allows the other task to start', async () => {
  const feedbackStates: EvaluationState[] = [];
  const flowchartStates: FlowchartState[] = [];
  const run = startAnalysisRun({
    requestFeedback: () => { throw new Error('Failed before dispatch'); },
    requestFlowchart: async () => flowchart,
    onFeedbackChange: (state) => feedbackStates.push(state),
    onFlowchartChange: (state) => flowchartStates.push(state),
  });
  await Promise.resolve();
  assert.deepEqual(feedbackStates.at(-1), { status: 'error', error: 'Failed before dispatch' });
  assert.deepEqual(flowchartStates.at(-1), { status: 'success', data: flowchart });
  assert.equal(run.isRunning(), false);
});

test('unknown errors have separate fallback messages and unlock the run', async () => {
  const { run, feedback, charts, feedbackStates, flowchartStates } = setup();
  feedback.reject(null);
  charts.reject('Unknown failure');
  await Promise.resolve();
  assert.deepEqual(feedbackStates.at(-1), { status: 'error', error: 'Failed to evaluate your code' });
  assert.deepEqual(flowchartStates.at(-1), { status: 'error', error: 'Failed to build the flowchart' });
  assert.equal(run.isRunning(), false);
});
