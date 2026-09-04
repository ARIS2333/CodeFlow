import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import type { FlowchartState } from '../src/lib/analysisRun.ts';
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
});
const { default: RightContent } = await import(panelUrl) as {
  default: ComponentType<{
    flowchartState: FlowchartState;
    traceState: TraceState;
    onRetrace: () => void;
  }>;
};

const generation: FlowchartGenerationContext = {
  mode: 'inferred', syntaxIssues: [{ ...missingTokenIssue }],
};
const render = (flowchartState: FlowchartState, traceState: TraceState = { status: 'idle' }) =>
  renderToStaticMarkup(createElement(RightContent, {
    flowchartState, traceState, onRetrace: () => {},
  }));

for (const state of [
  { status: 'loading', generation },
  { status: 'success', data: sampleGraph(), generation },
  { status: 'error', error: 'Model response failed', generation },
] satisfies FlowchartState[]) {
  test(`panel does not show a diagnostic card without model suggestions on ${state.status}`, () => {
    const html = render(state);
    assert.doesNotMatch(html, /Possible missing symbols|Parser diagnostics|Tree-sitter|model-inferred/);
    if (state.status === 'loading') assert.match(html, /Generating flowchart/);
    if (state.status === 'success') {
      assert.match(html, /Student&#x27;s Logic Flow/);
      assert.match(html, /Recommended Logic Flow/);
    }
    if (state.status === 'error') {
      assert.match(html, /Flowchart unavailable/);
      assert.match(html, /Model response failed/);
    }
  });
}

test('idle, parsing, and grounded panels do not show missing-symbol cards', () => {
  for (const state of [
    { status: 'idle' },
    { status: 'loading' },
    { status: 'success', data: sampleGraph(true), generation: { mode: 'grounded', syntaxIssues: [] } },
  ] satisfies FlowchartState[]) {
    assert.doesNotMatch(render(state), /Possible missing symbols|Parser diagnostics/);
  }
});

test('recovered code without a model suggestion does not show filler text', () => {
  const html = render({ status: 'loading', generation: { mode: 'inferred', syntaxIssues: [] } });
  assert.doesNotMatch(html, /Possible missing symbols|Parser diagnostics|syntax problems|ambiguous structure/);
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
  test(`model missing-symbol location is directly visible on ${state.status}`, () => {
    const html = render(state);
    assert.match(html, /Possible missing symbols detected/);
    assert.match(html, /<code[^>]*>}<\/code> — Line 10/);
    assert.match(html, /Line 10, after <code>return false;<\/code>/);
    assert.doesNotMatch(html, /<pre|<details|Parser diagnostics|The inner if block|confirmed fixes|code has not been changed/);
  });
}

test('unlocated suggestions are short; empty reports show no card', () => {
  const unlocated = render({ status: 'success', data: sampleGraph(), generation: {
    ...generation, missingSymbols: [{ symbol: '}', explanation: 'Several closing positions may be possible.' }],
  } });
  assert.match(unlocated, /<code[^>]*>}<\/code> — Location unknown/);
  assert.doesNotMatch(unlocated, /Line 10, after/);
  assert.doesNotMatch(unlocated, /Several closing positions/);
  const empty = render({ status: 'success', data: sampleGraph(), generation: { ...generation, missingSymbols: [] } });
  assert.doesNotMatch(empty, /Possible missing symbols|did not identify|code is valid/);
});

test('source references are escaped and model explanations are not displayed', () => {
  const html = render({ status: 'success', data: sampleGraph(), generation: { ...generation, missingSymbols: [{
    symbol: '}', explanation: '<script>bad()</script>',
    location: { line: 1, anchor: '<img>', placement: 'before', sourceLine: '<img>' },
  }] } });
  assert.doesNotMatch(html, /<script>|<img>/);
  assert.doesNotMatch(html, /&lt;script&gt;|bad\(\)/);
  assert.match(html, /&lt;img&gt;/);
});

test('multiple missing symbols share one title and use one compact item each', () => {
  const html = render({ status: 'success', data: sampleGraph(), generation: {
    ...withSuggestion,
    missingSymbols: [...withSuggestion.missingSymbols!, {
      symbol: ')', explanation: 'The condition may need a closing parenthesis.',
      location: { line: 4, anchor: '{', placement: 'before', sourceLine: 'if (n > 0 {' },
    }],
  } });
  assert.equal(html.match(/Possible missing symbols detected/g)?.length, 1);
  assert.equal(html.match(/<li\b/g)?.length, 2);
  assert.match(html, /Line 4, before <code>{<\/code>/);
  assert.doesNotMatch(html, /closing parenthesis|closing brace|Parser diagnostics/);
});

test('student graph replaces only its own loader while the reference is pending', () => {
  const html = render({ status: 'loading', progress: { attempt: 1, student: sampleGraph().student } });
  assert.equal(html.match(/Generating flowchart/g)?.length, 1);
  assert.match(html, /aria-label="Student&#x27;s Logic Flow" aria-busy="false"/);
  assert.match(html, /aria-label="Recommended Logic Flow" aria-busy="true"/);
});

test('a stream failure retains its completed graph and stops the other loader', () => {
  const html = render({ status: 'error', error: 'Connection closed', progress: { attempt: 1, student: sampleGraph().student } });
  assert.match(html, /Generation incomplete/);
  assert.match(html, /Connection closed/);
  assert.doesNotMatch(html, /Generating flowchart/);
  assert.equal(html.match(/Flowchart unavailable/g)?.length, 1);
});
