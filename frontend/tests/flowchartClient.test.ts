import { strict as assert } from 'node:assert';
import { test, type TestContext } from 'node:test';
import { STREAM_API_URL, CODE_ANALYSIS_URL } from '../src/config/apiConfig.ts';
import { streamResponse } from './streamFixtures.ts';
import { requestReliableFlowchart, type FlowchartRequest } from '../src/lib/flowchartClient.ts';
import { getFlowchartGenerationContext, type FlowchartGenerationContext } from '../src/lib/flowchartGeneration.ts';
import { createFlowchartValidator, validateFlowchart } from '../src/lib/llmSchemas.ts';
import type { CodeAnalysis } from '../src/lib/codeAnalysis.ts';
import { startAnalysisRun, type FlowchartState } from '../src/lib/analysisRun.ts';
import { analysisStub, missingElseBrace, missingPalindromeBrace, missingPythonColon, sampleGraph } from './flowchartFixtures.ts';

const request: FlowchartRequest = {
  practice: { title: 'Sign', description: 'Return 1 if positive, otherwise 0.', examples: [], constraints: [] },
  language: 'java',
  code: 'int f(int n) { if (n > 0) return 1; return 0; }',
};

const mockRequests = (t: TestContext, analysis: CodeAnalysis, replies: unknown[]) => {
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  let replyIndex = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(input), body });
    if (String(input) === CODE_ANALYSIS_URL) return Response.json(analysis);
    assert.equal(String(input), STREAM_API_URL);
    const reply = replies[Math.min(replyIndex++, replies.length - 1)];
    return streamResponse([{ type: 'delta', text: JSON.stringify(reply) }, { type: 'done' }]);
  });
  // Intentional bad replies below should not flood the test output.
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'info', () => {});
  return calls;
};

for (const language of ['java', 'python'] as const) {
  test(`${language}: clean code keeps facts, anchors, and one model request`, async (t) => {
    const analysis = analysisStub(language);
    const calls = mockRequests(t, analysis, [sampleGraph(true)]);
    const contexts: FlowchartGenerationContext[] = [];
    const code = language === 'java' ? request.code : 'def f(n):\n    if n > 0: return 1\n    return 0\n';
    const result = await requestReliableFlowchart({ ...request, language, code }, (context) => {
      assert.equal(calls.length, 1, 'publish diagnostics before requesting the model');
      contexts.push(context);
    });
    assert.deepEqual(contexts, [{ mode: 'grounded', syntaxIssues: [] }]);
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[1].body.message), { ...request, language, code, codeAnalysis: analysis });
    assert.match(calls[1].body.system_message, /SOURCE GROUNDING — this is mandatory/);
    // Existing missing-token normalization may leave optional keys undefined.
    assert.deepEqual(JSON.parse(JSON.stringify(result)), sampleGraph(true));
  });
}

for (const [name, language, code] of [
  ['Java else-if missing brace', 'java', missingElseBrace],
  ['Java palindrome missing brace', 'java', missingPalindromeBrace],
  ['Python missing colon', 'python', missingPythonColon],
] as const) {
  test(`${name}: switches before the first model call and omits all structural facts`, async (t) => {
    const analysis = analysisStub(language, true);
    // Simulate a misleading recovered classification, which must not bind the model.
    analysis.facts[0] = { ...analysis.facts[0], anchor: 'p1', kind: 'process', construct: 'local-variable-declaration', text: 'else if' };
    const calls = mockRequests(t, analysis, [sampleGraph()]);
    const contexts: FlowchartGenerationContext[] = [];
    await requestReliableFlowchart({ ...request, language, code }, (context) => {
      assert.equal(calls.length, 1);
      contexts.push(context);
    });
    assert.equal(contexts[0].mode, 'inferred');
    assert.deepEqual(contexts[0].syntaxIssues, analysis.syntaxIssues);
    assert.equal(calls.length, 2, 'one parser request and one LLM request, no grounded retries');
    assert.deepEqual(JSON.parse(calls[1].body.message), {
      ...request, language, code, parserDiagnostics: analysis.syntaxIssues,
    });
    assert.match(calls[1].body.system_message, /MODEL-INFERRED MODE/);
    assert.doesNotMatch(calls[1].body.system_message, /codeAnalysis|SOURCE GROUNDING/);
    assert.match(calls[1].body.system_message, /Do not emit sourceAnchors/);
    assert.match(calls[1].body.system_message, /including = versus ==/);
    assert.match(calls[1].body.system_message, /NOT a confirmed correction/);
  });
}

test('diagnostics force inference even if status is inconsistent; empty recovery still falls back', () => {
  const inconsistent = analysisStub('java', true);
  inconsistent.parseStatus = 'clean';
  assert.equal(getFlowchartGenerationContext(inconsistent).mode, 'inferred');
  inconsistent.parseStatus = 'recovered';
  inconsistent.syntaxIssues = [];
  assert.equal(getFlowchartGenerationContext(inconsistent).mode, 'inferred');
});

test('generation metadata copies issues rather than modifying the parser response', () => {
  const analysis = analysisStub('java', true);
  const context = getFlowchartGenerationContext(analysis);
  context.syntaxIssues[0].expected = ';';
  assert.equal(analysis.syntaxIssues[0].expected, '}');
});

test('inferred mode never auto-marks a token from a recovered anchor', async (t) => {
  const analysis = analysisStub('java', true);
  analysis.syntaxIssues[0] = { ...analysis.syntaxIssues[0], startByte: 1, endByte: 1, expected: ';' };
  const graph = sampleGraph(true);
  graph.student.nodes[1].data.label = 'n > 0';
  graph.student.nodes[2].data.syntaxErrors = [{ symbol: 'return', expected: ')' }];
  mockRequests(t, analysis, [graph]);
  const result = await requestReliableFlowchart({ ...request, code: 'n > 0' });
  assert.equal(result.student.nodes[1].data.syntaxErrors, undefined);
  assert.deepEqual(result.student.nodes[2].data.syntaxErrors, [{ symbol: 'return', expected: ')' }]);
  assert.ok(result.student.nodes.every((node) => !node.sourceAnchors));
});

test('clean mode still rejects missing anchors and retries in grounded mode', async (t) => {
  const calls = mockRequests(t, analysisStub(), [sampleGraph(), sampleGraph(true)]);
  await requestReliableFlowchart(request);
  assert.equal(calls.length, 3);
  assert.match(calls[2].body.message, /does not cover parser facts/);
  assert.match(calls[2].body.system_message, /SOURCE GROUNDING/);
});

test('a recovered process classification does not dictate the inferred node kind', () => {
  const analysis = analysisStub('java', true);
  analysis.facts[0].kind = 'process';
  const graph = sampleGraph(true);
  const grounded = createFlowchartValidator(analysis)(graph);
  assert.equal(grounded.ok, false);
  if (!grounded.ok) assert.ok(grounded.errors.some((error) => error.includes('is a "process" fact')));
  assert.equal(validateFlowchart(graph).ok, true);
});

for (const [name, corrupt] of [
  ['broken edge', (graph: ReturnType<typeof sampleGraph>) => { graph.student.edges[0].target = 'missing'; }],
  ['process with two exits', (graph: ReturnType<typeof sampleGraph>) => { graph.student.nodes[1].kind = 'process'; }],
  ['unlabelled condition', (graph: ReturnType<typeof sampleGraph>) => { delete graph.student.edges[1].label; }],
  ['terminal with an exit', (graph: ReturnType<typeof sampleGraph>) => { graph.student.edges.push({ id: 'bad', source: '3', target: '4' }); }],
  ['unreachable node', (graph: ReturnType<typeof sampleGraph>) => { graph.student.nodes.push({ id: '5', kind: 'end', data: { label: 'END' } }); }],
  ['duplicate node ID', (graph: ReturnType<typeof sampleGraph>) => { graph.student.nodes[3].id = '3'; }],
  ['invalid reference graph', (graph: ReturnType<typeof sampleGraph>) => { graph.llm.edges[0].target = 'missing'; }],
] as const) {
  test(`inferred validation still rejects ${name}`, () => {
    const graph = sampleGraph();
    corrupt(graph);
    assert.equal(validateFlowchart(graph).ok, false);
  });
}

test('inferred mode keeps its prompt and diagnostics on output retries', async (t) => {
  const broken = sampleGraph();
  broken.student.nodes[1].kind = 'process';
  const calls = mockRequests(t, analysisStub('java', true), [broken, sampleGraph()]);
  const contexts: FlowchartGenerationContext[] = [];
  await requestReliableFlowchart(request, (context) => contexts.push(context));
  assert.equal(contexts.length, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].body.system_message, calls[2].body.system_message);
  assert.match(calls[2].body.message, /must have exactly one outgoing edge/);
  assert.doesNotMatch(calls[2].body.message, /codeAnalysis|sourceAnchors/);
});

test('inferred mode reports a graph failure after the existing three attempts', async (t) => {
  const broken = sampleGraph();
  broken.student.nodes[1].kind = 'process';
  const calls = mockRequests(t, analysisStub('java', true), [broken]);
  await assert.rejects(requestReliableFlowchart(request), /model-inferred flowchart:.*3 times.*exactly one outgoing edge/);
  assert.equal(calls.length, 4);
});

test('an invalid parser API response is not mistaken for recovered student syntax', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    calls.push(String(input));
    return Response.json({ error: 'Unsupported language' });
  });
  await assert.rejects(requestReliableFlowchart(request), /code analysis: Unsupported language/);
  assert.deepEqual(calls, [CODE_ANALYSIS_URL]);
});

const missingBraceReport = {
  symbol: '}', line: 10, anchor: 'return false;', placement: 'after',
  explanation: 'The inner if block may need a closing brace before the loop continues.',
};

test('the same inferred response publishes located model suggestions without an extra LLM call', async (t) => {
  const calls = mockRequests(t, analysisStub('java', true), [{ ...sampleGraph(), missingSymbols: [missingBraceReport] }]);
  const contexts: FlowchartGenerationContext[] = [];
  const result = await requestReliableFlowchart({ ...request, code: missingPalindromeBrace }, (context) => contexts.push(context));
  assert.equal(calls.length, 2);
  assert.match(calls[1].body.system_message, /MISSING-SYMBOL FEEDBACK/);
  assert.match(calls[1].body.system_message, /"missingSymbols":/);
  assert.equal(contexts[0].missingSymbols, undefined, 'no model report before the response');
  assert.deepEqual(contexts[1].missingSymbols, [{
    symbol: '}', explanation: missingBraceReport.explanation,
    location: { line: 10, anchor: 'return false;', placement: 'after', sourceLine: '                return false;' },
  }]);
  assert.deepEqual(result, sampleGraph(), 'suggestions are metadata, not commentary nodes');
});

test('malformed missing-symbol feedback cannot reject a valid inferred graph or cost a retry', async (t) => {
  const calls = mockRequests(t, analysisStub('java', true), [{ ...sampleGraph(), missingSymbols: 'missing brace' }]);
  const contexts: FlowchartGenerationContext[] = [];
  assert.deepEqual(await requestReliableFlowchart(request, (context) => contexts.push(context)), sampleGraph());
  assert.equal(calls.length, 2);
  assert.equal(contexts.length, 1);
});

test('grounded mode does not request or display incidental model missing-symbol feedback', async (t) => {
  const calls = mockRequests(t, analysisStub(), [{ ...sampleGraph(true), missingSymbols: [missingBraceReport] }]);
  const contexts: FlowchartGenerationContext[] = [];
  await requestReliableFlowchart(request, (context) => contexts.push(context));
  assert.doesNotMatch(calls[1].body.system_message, /missingSymbols|MISSING-SYMBOL FEEDBACK/);
  assert.deepEqual(contexts, [{ mode: 'grounded', syntaxIssues: [] }]);
});

test('a later explicit empty model report replaces earlier suggestions', async (t) => {
  const broken = sampleGraph();
  broken.student.nodes[1].kind = 'process';
  mockRequests(t, analysisStub('java', true), [
    { ...broken, missingSymbols: [missingBraceReport] },
    { ...sampleGraph(), missingSymbols: [] },
  ]);
  const contexts: FlowchartGenerationContext[] = [];
  await requestReliableFlowchart({ ...request, code: missingPalindromeBrace }, (context) => contexts.push(context));
  assert.equal(contexts[1].missingSymbols?.length, 1);
  assert.deepEqual(contexts.at(-1)?.missingSymbols, []);
});

test('model suggestions survive all graph failures, even if later feedback is malformed', async (t) => {
  const broken = sampleGraph();
  broken.student.nodes[1].kind = 'process';
  const calls = mockRequests(t, analysisStub('java', true), [
    { ...broken, missingSymbols: [missingBraceReport] },
    { ...broken, missingSymbols: [null] },
  ]);
  const states: FlowchartState[] = [];
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => { finish = resolve; });
  startAnalysisRun({
    requestFeedback: async () => ({ IsCorrect: false, TestResults: [] }),
    requestFlowchart: (report) => requestReliableFlowchart({ ...request, code: missingPalindromeBrace }, report),
    onFeedbackChange: () => {},
    onFlowchartChange: (state) => {
      states.push(state);
      if (state.status === 'success' || state.status === 'error') finish();
    },
  });
  await settled;
  assert.equal(calls.length, 4);
  const final = states.at(-1);
  assert.equal(final?.status, 'error');
  if (final?.status === 'error') {
    assert.equal(final.generation?.missingSymbols?.[0].location?.line, 10);
    assert.equal(final.generation?.syntaxIssues.length, 1);
  }
});
