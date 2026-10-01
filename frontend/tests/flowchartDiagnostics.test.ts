import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import type { EvaluationState, FlowchartState } from '../src/lib/analysisRun.ts';
import type { FlowchartGenerationContext } from '../src/lib/flowchartGeneration.ts';
import type { TraceState } from '../src/lib/traceRun.ts';
import { missingTokenIssue, sampleGraph } from './flowchartFixtures.ts';

// Node's type stripper does not handle TSX. Transpile these small views in
// memory using our existing TypeScript dependency; do not launch a browser.
const viewModule = (filename: string, replacements: Record<string, string> = {}) => {
  const source = readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const resolved = outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier: string) =>
    `from ${JSON.stringify(replacements[specifier] ?? import.meta.resolve(specifier))}`);
  return `data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`;
};

const diagnosticsUrl = viewModule('FlowchartDiagnostics.tsx');
// Exercise the real panel and warning component, stubbing only the unrelated
// interactive canvas so these tests do not depend on browser measurement APIs.
const panelUrl = viewModule('RightContent.tsx', {
  './FlowchartDiagnostics': diagnosticsUrl,
  './FlowchartDiagram': 'data:text/javascript,export default function Diagram(){return null}',
  './TracePanel': viewModule('TracePanel.tsx'),
  './lib/executionTrace': import.meta.resolve('../src/lib/executionTrace.ts'),
  './lib/tracePresentation': import.meta.resolve('../src/lib/tracePresentation.ts'),
});
const { default: RightContent } = await import(panelUrl) as {
  default: ComponentType<{
    flowchartState: FlowchartState;
    evaluationState?: EvaluationState;
    traceState: TraceState;
    onRetrace: () => void;
  }>;
};

const generation: FlowchartGenerationContext = {
  mode: 'inferred', syntaxIssues: [{ ...missingTokenIssue }],
};
const render = (
  flowchartState: FlowchartState,
  traceState: TraceState = { status: 'idle' },
  evaluationState?: EvaluationState,
) =>
  renderToStaticMarkup(createElement(RightContent, {
    flowchartState, traceState, evaluationState, onRetrace: () => {},
  }));

for (const state of [
  { status: 'loading', generation },
  { status: 'success', data: sampleGraph(), generation },
  { status: 'error', error: 'Model response failed', generation },
] satisfies FlowchartState[]) {
  test(`inferred-mode notice does not invent missing symbols on ${state.status}`, () => {
    const html = render(state);
    assert.doesNotMatch(html, /Possible missing symbols|Parser diagnostics|Tree-sitter|model-inferred/);
    assert.match(html, /Flowchart inferred from incomplete code/);
    assert.match(html, /may not represent an executable program/);
    if (state.status === 'loading') assert.match(html, /Generating flowchart/);
    if (state.status === 'success') {
      assert.match(html, /Student&#x27;s Logic Flow/);
      assert.match(html, /Recommended Logic Flow/);
    }
    if (state.status === 'error') {
      assert.match(html, /Flowchart generation failed/);
      assert.match(html, /try Regenerate Flowcharts/);
      assert.doesNotMatch(html, /Model response failed/);
    }
  });
}

test('idle, parsing, and grounded panels do not show inferred-mode cards', () => {
  for (const state of [
    { status: 'idle' },
    { status: 'loading' },
    { status: 'success', data: sampleGraph(true), generation: { mode: 'grounded', syntaxIssues: [] } },
  ] satisfies FlowchartState[]) {
    assert.doesNotMatch(render(state), /Flowchart inferred|Possible missing symbols|Parser diagnostics/);
  }
});

test('a terminal compile error warns beside an otherwise grounded flowchart', () => {
  const html = render(
    { status: 'success', data: sampleGraph(true), generation: { mode: 'grounded', syntaxIssues: [] } },
    { status: 'idle' },
    { status: 'success', data: {
      IsCorrect: false,
      TestResults: [{ input: 'f(1)', expected: 'true', yourOutput: '❌ Compile Error' }],
    } },
  );
  assert.match(html, /Flowchart generated from code with an error/);
  assert.match(html, /simulated run reported a compile error/);
  assert.match(html, /program cannot run as written/);
});

test('ordinary wrong answers do not create a compile warning', () => {
  const html = render(
    { status: 'success', data: sampleGraph(true), generation: { mode: 'grounded', syntaxIssues: [] } },
    { status: 'idle' },
    { status: 'success', data: {
      IsCorrect: false,
      TestResults: [{ input: 'f(1)', expected: 'true', yourOutput: '❌ false' }],
    } },
  );
  assert.doesNotMatch(html, /Flowchart generated from code with an error|simulated run reported/);
});

test('recovered code without a model suggestion still explains the inferred graph', () => {
  const html = render({ status: 'loading', generation: { mode: 'inferred', syntaxIssues: [] } });
  assert.match(html, /Flowchart inferred from incomplete code/);
  assert.doesNotMatch(html, /Possible missing symbols|Parser diagnostics/);
});

test('parser recovery text is not displayed as model missing-symbol feedback', () => {
  const html = render({ status: 'loading', generation: {
    mode: 'inferred', syntaxIssues: [{ ...missingTokenIssue, text: '<script>alert(1)</script>', expected: '<b>' }],
  } });
  assert.doesNotMatch(html, /<script>|<b>|&lt;script&gt;|&lt;b&gt;|Parser diagnostics/);
});

const withSuggestion: FlowchartGenerationContext = {
  ...generation,
  missingSymbols: [{
    symbol: '}', explanation: 'The inner if block may need a closing brace.',
    location: { line: 10, anchor: 'return false;', placement: 'after', sourceLine: '    return false;' },
  }],
};

for (const state of [
  { status: 'loading', generation: withSuggestion },
  { status: 'success', data: sampleGraph(), generation: withSuggestion },
  { status: 'error', error: 'Invalid graph', generation: withSuggestion },
] satisfies FlowchartState[]) {
  test(`model missing-symbol guesses stay out of the summary on ${state.status}`, () => {
    const html = render(state);
    assert.match(html, /Flowchart inferred from incomplete code/);
    assert.doesNotMatch(html, /Possible missing symbols|Line 10|return false|The inner if block/);
  });
}

test('located and unlocated suggestions are both omitted from the summary', () => {
  const unlocated = render({ status: 'success', data: sampleGraph(), generation: {
    ...generation, missingSymbols: [{ symbol: '}', explanation: 'Several closing positions may be possible.' }],
  } });
  assert.doesNotMatch(unlocated, /Possible missing symbols|Location unknown|Several closing positions/);
  assert.match(unlocated, /Flowchart inferred from incomplete code/);
  const empty = render({ status: 'success', data: sampleGraph(), generation: { ...generation, missingSymbols: [] } });
  assert.doesNotMatch(empty, /Possible missing symbols|did not identify|code is valid/);
  assert.match(empty, /Flowchart inferred from incomplete code/);
});

test('source references are escaped and model explanations are not displayed', () => {
  const html = render({ status: 'success', data: sampleGraph(), generation: { ...generation, missingSymbols: [{
    symbol: '}', explanation: '<script>bad()</script>',
    location: { line: 1, anchor: '<img>', placement: 'before', sourceLine: '<img>' },
  }] } });
  assert.doesNotMatch(html, /<script>|<img>/);
  assert.doesNotMatch(html, /&lt;script&gt;|bad\(\)/);
  assert.doesNotMatch(html, /&lt;img&gt;/);
});

test('multiple missing symbols do not add a second diagnostic section', () => {
  const html = render({ status: 'success', data: sampleGraph(), generation: {
    ...withSuggestion,
    missingSymbols: [...withSuggestion.missingSymbols!, {
      symbol: ')', explanation: 'The condition may need a closing parenthesis.',
      location: { line: 4, anchor: '{', placement: 'before', sourceLine: 'if (n > 0 {' },
    }],
  } });
  assert.doesNotMatch(html, /Possible missing symbols|<li\b|Line 4|closing parenthesis|closing brace|Parser diagnostics/);
  assert.match(html, /Flowchart inferred from incomplete code/);
});

test('student graph replaces only its own loader while the reference is pending', () => {
  const html = render({ status: 'loading', progress: { attempt: 1, student: sampleGraph().student } });
  assert.equal(html.match(/Generating flowchart/g)?.length, 1);
  assert.match(html, /aria-label="Student&#x27;s Logic Flow" aria-busy="false"/);
  assert.match(html, /aria-label="Recommended Logic Flow" aria-busy="true"/);
});

test('a stream failure retains its completed graph and stops the other loader', () => {
  const html = render({ status: 'error', error: 'Connection closed', progress: { attempt: 1, student: sampleGraph().student } });
  assert.match(html, /Flowchart generation failed/);
  assert.match(html, /syntax or compile error/);
  assert.match(html, /temporary generation issue/);
  assert.doesNotMatch(html, /Connection closed/);
  assert.doesNotMatch(html, /Generating flowchart/);
  assert.equal(html.match(/Flowchart unavailable/g)?.length, 1);
});
