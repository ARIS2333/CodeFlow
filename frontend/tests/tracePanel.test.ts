import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import type { FlowchartRegenerationState, FlowchartState } from '../src/lib/analysisRun.ts';
import type { TraceState } from '../src/lib/traceRun.ts';
import { createTraceValidator } from '../src/lib/executionTrace.ts';
import { traceGraphs, traceReply } from './traceFixtures.ts';

// Same in-memory transpile as the diagnostics view tests: Node's type stripper
// does not handle TSX, and these views are not worth a browser.
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

const { default: RightContent } = await import(viewModule('RightContent.tsx', {
  './FlowchartDiagnostics': 'data:text/javascript,export default function Diagnostics(){return null}',
  './FlowchartDiagram': 'data:text/javascript,export default function Diagram(){return null}',
  './TracePanel': viewModule('TracePanel.tsx'),
  './lib/executionTrace': import.meta.resolve('../src/lib/executionTrace.ts'),
  './lib/tracePresentation': import.meta.resolve('../src/lib/tracePresentation.ts'),
})) as {
  default: ComponentType<{
    flowchartState: FlowchartState;
    traceState: TraceState;
    onRetrace: () => void;
    onRegenerateFlowchart: () => void;
    canRegenerateFlowchart: boolean;
    flowchartRegenerationState: FlowchartRegenerationState;
  }>;
};

const graphs = traceGraphs();
const validated = createTraceValidator(graphs)(traceReply());
assert.equal(validated.ok, true);
const trace = validated.ok ? validated.value : undefined;

const traceRequest = {
  practice: { title: 'Sum', description: '', examples: [], constraints: [] },
  language: 'java' as const,
  code: 'int f(int a, int b) {}',
  graphs,
  testCase: { input: 'f(3, 3)', expected: '6', observedOutput: '❌ 3' },
};

const render = (traceState: TraceState) =>
  renderToStaticMarkup(createElement(RightContent, {
    flowchartState: { status: 'success', data: graphs },
    traceState,
    onRetrace: () => {},
    onRegenerateFlowchart: () => {},
    canRegenerateFlowchart: true,
    flowchartRegenerationState: { status: 'idle' },
  }));

// The trace area is a separate section, so each half can be asserted on its own.
const split = (html: string) => {
  const parts = html.split('aria-label="Execution trace"');
  assert.equal(parts.length, 2, 'exactly one trace section');
  return { above: parts[0], below: parts[1] };
};

test('no trace means no trace area at all, not an empty player', () => {
  const html = render({ status: 'idle' });
  assert.doesNotMatch(html, /Execution Trace|Step 1|Re-trace|aria-label="Execution trace"/);
  assert.match(html, /Student&#x27;s Logic Flow/, 'the comparison charts stay');
});

test('the comparison charts above are left alone while the run is replayed below', () => {
  const { above, below } = split(render({ status: 'success', request: traceRequest, data: trace! }));

  // Above: the original side-by-side comparison, with no step readout on it.
  assert.match(above, /Student&#x27;s Logic Flow/);
  assert.match(above, /Recommended Logic Flow/);
  assert.match(above, /Regenerate Flowcharts/);
  assert.doesNotMatch(above, /at 1|Step 1 \/ 4|Re-trace/);

  // Below: the same two graphs again, under their own titles, carrying the run.
  assert.match(below, /Student&#x27;s Run/);
  assert.match(below, /Recommended Run/);
  assert.equal((below.match(/Step 1 of 4/g) ?? []).length, 2, 'each replayed side reports its own step');
  assert.doesNotMatch(below, /at 1/, 'model-written step explanations are not displayed');
});

test('an untraceable run explains itself in its own area, without redrawing the charts', () => {
  const { above, below } = split(render({ status: 'skipped', reason: 'The code did not run for any input.' }));
  assert.match(above, /Student&#x27;s Logic Flow/);
  assert.match(below, /Execution trace unavailable/);
  assert.match(below, /The code did not run for any input\./);
  assert.doesNotMatch(below, /Student&#x27;s Run|Step 1|Re-trace/);
});

test('a trace still being generated says so, rather than showing a silent empty area', () => {
  const { below } = split(render({ status: 'loading', request: traceRequest }));
  assert.match(below, /The AI is working through this input step by step/);
  assert.doesNotMatch(below, /Student&#x27;s Run/, 'no player until there are steps to play');
});

test('a finished trace offers the input it walked and manual step controls', () => {
  const html = render({ status: 'success', request: traceRequest, data: trace! });
  assert.match(html, /Execution Trace/);
  assert.match(html, /value="f\(3, 3\)"/, 'the traced input is editable and pre-filled');
  assert.match(html, /Step 1 \/ 4/);
  assert.match(html, /Prev/);
  assert.match(html, /Next/);
  assert.match(html, /Start/);
  assert.match(html, /End/);
  assert.match(html, /Reset/);
  assert.match(html, /Re-trace/);
  assert.doesNotMatch(html, /Regenerate Trace/);
  assert.doesNotMatch(html, /Go to first difference/);
});

test('trace navigation sits between the run diagrams and their state cards', () => {
  const { below } = split(render({ status: 'success', request: traceRequest, data: trace! }));
  const diagrams = below.indexOf('Recommended Run');
  const controls = below.indexOf('aria-label="Trace navigation"');
  const details = below.indexOf('Step 1 of 4');
  assert.ok(diagrams >= 0 && controls > diagrams && details > controls);
});

test('the step readout carries that side\'s own variables', () => {
  const { below } = split(render({ status: 'success', request: traceRequest, data: trace! }));
  assert.match(below, /All variables/);
  assert.match(below, /a<\/dt>/);
  assert.match(below, />3<\/dd>/);
  assert.doesNotMatch(below, /<details|<summary|Current operation|Source ·| · Operation|Result:|cut off before/);
});

test('a streaming trace is usable from the moment the student side lands', () => {
  const { below } = split(render({
    status: 'loading',
    request: traceRequest,
    progress: { attempt: 1, student: trace!.student },
  }));
  assert.match(below, /Tracing this input/);
  assert.match(below, /Step 1 \/ 4/);
  assert.match(below, /Student&#x27;s Run/);
});

test('a disagreement warning is not displayed in the trace controls', () => {
  const html = render({
    status: 'success', request: traceRequest, data: trace!,
    warning: 'This trace ends with 3, but running the code reported 5.',
  });
  assert.doesNotMatch(html, /running the code reported 5|read the steps as a suggestion/);
});

test('a failed trace reports why and leaves the comparison charts standing', () => {
  const { above, below } = split(render({ status: 'error', request: traceRequest, error: 'Model stream failed' }));
  assert.match(below, /Could not trace this input/);
  assert.match(below, /Model stream failed/);
  assert.match(above, /Student&#x27;s Logic Flow/);
  assert.match(above, /Recommended Logic Flow/);
});
