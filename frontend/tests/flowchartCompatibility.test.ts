import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { areFlowchartsTraceCompatible } from '../src/lib/flowchartCompatibility.ts';
import { traceGraphs } from './traceFixtures.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test('trace compatibility ignores array order and non-trace metadata', () => {
  const previous = traceGraphs();
  const next = clone(previous);
  next.student.nodes.reverse();
  next.student.edges.reverse();
  next.student.nodes[0].sourceAnchors = ['different anchor'];
  next.student.nodes[0].data.syntaxErrors = [{ symbol: ';' }];
  assert.equal(areFlowchartsTraceCompatible(previous, next), true);
});

test('a node id, label, kind, or edge change requires a new trace', () => {
  const previous = traceGraphs();

  const changedId = clone(previous);
  changedId.student.nodes[0].id = 'new-id';
  assert.equal(areFlowchartsTraceCompatible(previous, changedId), false);

  const changedLabel = clone(previous);
  changedLabel.llm.nodes[0].data.label = 'Different start';
  assert.equal(areFlowchartsTraceCompatible(previous, changedLabel), false);

  const changedKind = clone(previous);
  changedKind.student.nodes[0].kind = 'process';
  assert.equal(areFlowchartsTraceCompatible(previous, changedKind), false);

  const changedEdge = clone(previous);
  changedEdge.llm.edges[0].label = 'different branch';
  assert.equal(areFlowchartsTraceCompatible(previous, changedEdge), false);
});
