import { strict as assert } from 'node:assert';
import { test, type TestContext } from 'node:test';
import { API_URL, CODE_ANALYSIS_URL } from '../src/config/apiConfig.ts';
import { requestReliableFlowchart, type FlowchartRequest } from '../src/lib/flowchartClient.ts';
import { getFlowchartGenerationContext } from '../src/lib/flowchartGeneration.ts';
import { analysisStub, sampleGraph } from './flowchartFixtures.ts';
import type { CodeAnalysis } from '../src/lib/codeAnalysis.ts';

const TEST_MODEL_CONFIG = { provider: 'openai', model: 'gpt-6.1-sol', apiKey: 'sk-test' } as const;
const request: FlowchartRequest = {
  practice: { title: 'Sign', description: 'Return 1 if positive, otherwise 0.', examples: [], constraints: [] },
  language: 'cpp',
  code: 'int f(int n) { if (n > 0) return 1; return 0; }',
};

const successfulAnalysis = (language: CodeAnalysis['language'] = 'cpp'): CodeAnalysis => {
  const analysis = analysisStub(language);
  analysis.compilerStatus = language === 'cpp' ? 'passed' : 'not-run';
  return analysis;
};

const mockPipeline = (
  t: TestContext,
  studentAnalysis: CodeAnalysis,
  recommendedAnalyses: CodeAnalysis[],
) => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let analysisIndex = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body });
    if (url === CODE_ANALYSIS_URL) {
      if (analysisIndex++ === 0) return Response.json(studentAnalysis);
      return Response.json(recommendedAnalyses.shift() ?? successfulAnalysis(studentAnalysis.language));
    }
    assert.equal(url, API_URL);
    return Response.json({ body: JSON.stringify({ response: JSON.stringify({
      approachSummary: 'Use the same condition and returns.',
      recommendedCode: request.code,
    }) }) });
  });
  return calls;
};

test('student flow is deterministic and displayed before the recommendation finishes', async (t) => {
  const calls = mockPipeline(t, successfulAnalysis(), [successfulAnalysis()]);
  const progress: Array<{ student?: unknown; llm?: unknown }> = [];
  const result = await requestReliableFlowchart(request, {
    modelConfig: TEST_MODEL_CONFIG,
    onProgress: (update) => progress.push(update),
  });
  assert.deepEqual(result.student, sampleGraph(true).student);
  assert.deepEqual(result.llm, sampleGraph().llm);
  assert.equal(result.recommendedCode, request.code);
  assert.ok(progress[0].student);
  assert.equal(progress[0].llm, undefined);
  assert.ok(progress.at(-1)?.llm);
  assert.deepEqual(calls.map((call) => call.url), [CODE_ANALYSIS_URL, API_URL, CODE_ANALYSIS_URL]);
  assert.match(String(calls[1].body.system_message), /corrected implementation/i);
  assert.doesNotMatch(String(calls[1].body.system_message), /"nodes"|"edges"/);
});

test('recommendation prompt contains the problem and exact student source', async (t) => {
  const calls = mockPipeline(t, successfulAnalysis(), [successfulAnalysis()]);
  await requestReliableFlowchart(request, { modelConfig: TEST_MODEL_CONFIG });
  const message = JSON.parse(String(calls[1].body.message));
  assert.deepEqual(message.practice, request.practice);
  assert.equal(message.language, 'cpp');
  assert.equal(message.studentCode, request.code);
  const prompt = String(calls[1].body.system_message);
  assert.match(prompt, /strict minimal-repair policy/i);
  assert.match(prompt, /semantically valid implementation choices as intentional/i);
  assert.match(prompt, /Do not substitute an equivalent construct or representation/i);
  assert.match(prompt, /already correct,[\s\S]*without stylistic[\s\S]*changes/i);
});

test('a recommendation that does not compile is regenerated with diagnostics', async (t) => {
  const broken = successfulAnalysis();
  broken.compilerStatus = 'failed';
  broken.compileIssues = [{
    id: 'compile-1', kind: 'cpp-compiler-error', text: 'expected declaration',
    startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startByte: 0, endByte: 0,
  }];
  const calls = mockPipeline(t, successfulAnalysis(), [broken, successfulAnalysis()]);
  await requestReliableFlowchart(request, { modelConfig: TEST_MODEL_CONFIG });
  assert.deepEqual(calls.map((call) => call.url), [
    CODE_ANALYSIS_URL, API_URL, CODE_ANALYSIS_URL, API_URL, CODE_ANALYSIS_URL,
  ]);
  const retryMessage = JSON.parse(String(calls[3].body.message));
  assert.deepEqual(retryMessage.previousAttemptDiagnostics, ['expected declaration']);
});

test('syntax recovery never delegates the student graph to the model', async (t) => {
  const recovered = analysisStub('cpp', true);
  recovered.compilerStatus = 'failed';
  const calls = mockPipeline(t, recovered, [successfulAnalysis()]);
  const contexts: ReturnType<typeof getFlowchartGenerationContext>[] = [];
  const result = await requestReliableFlowchart(request, {
    modelConfig: TEST_MODEL_CONFIG,
    onGenerationReady: (context) => contexts.push(context),
  });
  assert.equal(contexts[0].mode, 'inferred');
  assert.deepEqual(JSON.parse(JSON.stringify(result.student)), recovered.studentFlowchart);
  assert.equal(calls.filter((call) => call.url === API_URL).length, 1);
  assert.doesNotMatch(String(calls[1].body.system_message), /infer.*student.*flowchart/i);
});

test('invalid parser responses stop before spending a model call', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    calls.push(String(input));
    return Response.json({ error: 'Unsupported language' });
  });
  await assert.rejects(
    requestReliableFlowchart(request, { modelConfig: TEST_MODEL_CONFIG }),
    /code analysis: Unsupported language/,
  );
  assert.deepEqual(calls, [CODE_ANALYSIS_URL]);
});
