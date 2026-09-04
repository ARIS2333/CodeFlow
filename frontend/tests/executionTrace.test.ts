import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  MAX_TRACE_STEPS,
  createTraceValidator,
  traceDivergenceIndex,
  validateTraceSideOnly,
} from '../src/lib/executionTrace.ts';
import { loopGraph, traceGraphs, traceReply } from './traceFixtures.ts';

const graphs = traceGraphs();
const validate = createTraceValidator(graphs);

const expectErrors = (reply: unknown, match: RegExp) => {
  const result = validate(reply);
  assert.equal(result.ok, false);
  assert.match((result as { errors: string[] }).errors.join(' | '), match);
};

test('a navigable trace is accepted and its branch labels come from the drawn edges', () => {
  const result = validate(traceReply());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.student.steps.map((step) => step.nodeId), ['1', '2', '4', '5']);
  // The model never states which branch it took; the edge it walked says so.
  assert.equal(result.value.student.steps[1].branch, 'false');
  assert.equal(result.value.llm.steps[1].branch, 'true');
  assert.equal(result.value.student.steps[0].branch, undefined, 'an unlabelled edge adds no branch');
  assert.equal(result.value.student.truncated, false);
  assert.equal(result.value.student.finalOutput, '3');
});

test('a node from the other side is rejected rather than highlighted on the wrong graph', () => {
  const reply = traceReply();
  reply.student.steps[2].nodeId = '9';
  expectErrors(reply, /student\.steps\[2\] names node "9", which is not in the student flowchart/);
});

test('a step that is not one edge away from the previous step is rejected', () => {
  const reply = traceReply();
  // 2 -> 5 skips the assignment; the panel would animate a jump that is not drawn.
  reply.student.steps = [reply.student.steps[0], reply.student.steps[1], reply.student.steps[3]];
  expectErrors(reply, /moves from node "2" to "5", but the flowchart has no edge between them/);
});

test('only the first broken hop is reported, since the rest of the path is meaningless', () => {
  const reply = traceReply();
  reply.student.steps = ['1', '5', '3', '2'].map((nodeId) => ({ nodeId, variables: {}, note: '' }));
  const result = validate(reply);
  assert.equal(result.ok, false);
  const hops = (result as { errors: string[] }).errors.filter((error) => error.includes('no edge between'));
  assert.equal(hops.length, 1);
});

test('a trace that does not begin at the start node is rejected', () => {
  const reply = traceReply();
  reply.student.steps = reply.student.steps.slice(1);
  expectErrors(reply, /"student\.steps" begins at node "2"; it must begin at the start node "1"/);
});

test('an empty or missing trace is rejected instead of showing an empty player', () => {
  expectErrors({ ...traceReply(), student: { steps: [], finalOutput: '', truncated: false } }, /"student\.steps" is empty/);
  expectErrors({ llm: traceReply().llm }, /"student" is missing or is not an object/);
  expectErrors('not json', /the reply is not a JSON object/);
});

test('stopping short of an exit is shown as incomplete rather than as a finished run', () => {
  const reply = traceReply();
  reply.student.steps = reply.student.steps.slice(0, 3);
  const result = validate(reply);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.student.truncated, true);
  assert.match(result.value.student.steps.length ? result.repairs.join(' ') : '', /is not an exit/);
});

test('a run longer than the step cap is cut and marked, not rejected', () => {
  // A legal walk: start, then around the loop for as long as we like.
  const spin = ['1', ...Array.from({ length: MAX_TRACE_STEPS + 40 }, (_unused, index) =>
    index % 2 === 0 ? '2' : '3')];
  const result = validateTraceSideOnly(
    'student',
    { steps: spin.map((nodeId) => ({ nodeId, variables: {}, note: '' })), finalOutput: '', truncated: false },
    loopGraph(),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.steps.length, MAX_TRACE_STEPS);
  assert.equal(result.value.truncated, true, 'a cut run must not read as a finished one');
  assert.match(result.repairs.join(' '), new RegExp(`cut to the first ${MAX_TRACE_STEPS} steps`));
});

test('unusable variables are dropped without failing the trace', () => {
  const reply = traceReply();
  reply.student.steps[0].variables = {
    kept: 'yes',
    numeric: 7,
    nested: { deep: true },
    ...Object.fromEntries(Array.from({ length: 12 }, (_unused, index) => [`v${index}`, String(index)])),
  } as never;
  const result = validate(reply);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const variables = result.value.student.steps[0].variables;
  assert.equal(variables.length, 8);
  assert.deepEqual(variables[0], { name: 'kept', value: 'yes' });
  assert.deepEqual(variables[1], { name: 'numeric', value: '7' }, 'a scalar is read, not refused');
  assert.ok(!variables.some((variable) => variable.name === 'nested'));
  assert.match(result.repairs.join(' '), /dropped \d+ variable/);
});

test('one side can be validated on its own so it is displayable while the other streams', () => {
  const reply = traceReply();
  assert.equal(validateTraceSideOnly('student', reply.student, graphs.student).ok, true);
  // The same walk read against a differently shaped graph is refused, not shown.
  assert.equal(validateTraceSideOnly('student', reply.student, loopGraph()).ok, false);
  assert.equal(validateTraceSideOnly('student', { steps: [{ nodeId: '404' }] }, graphs.student).ok, false);
});

test('divergence is the first step where the two runs stop doing the same thing', () => {
  const reply = traceReply();
  const result = validate(reply);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Step 1 is START on both sides; step 2 compares "a > b" against "a >= b".
  assert.equal(traceDivergenceIndex(result.value, graphs), 1);
});

test('identical runs report no divergence, and a shorter run diverges where it ends', () => {
  // Divergence is read off the labels each side actually shows, so "identical"
  // means the same walk over the same drawing, not merely the same node ids.
  const matching = { student: graphs.llm, llm: graphs.llm };
  const same = createTraceValidator(matching)({ student: traceReply().llm, llm: traceReply().llm });
  assert.equal(same.ok, true);
  if (!same.ok) return;
  assert.equal(traceDivergenceIndex(same.value, matching), null);

  const shorter = createTraceValidator(matching)({
    student: { ...traceReply().llm, steps: traceReply().llm.steps.slice(0, 3), truncated: true },
    llm: traceReply().llm,
  });
  assert.equal(shorter.ok, true);
  if (!shorter.ok) return;
  assert.equal(traceDivergenceIndex(shorter.value, matching), 3);
});
