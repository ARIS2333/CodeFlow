import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Position } from '@xyflow/react';
import { layoutWithElk, type LayoutEngine } from '../src/lib/elkFlowchartLayout.ts';
import type { DiagramNode, DiagramEdge } from '../src/lib/flowchartLayout.ts';
import { palindromeGraph, nestedGraph, branchGraph, jumpGraph } from './elkLayoutFixtures.ts';

const byId = (nodes: DiagramNode[]) => new Map(nodes.map((node) => [node.id, node]));
const edge = (edges: DiagramEdge[], source: string, target: string) =>
  edges.find((item) => item.source === source && item.target === target)!;

const assertCleanGeometry = (nodes: DiagramNode[], edges: DiagramEdge[]) => {
  const boxes = nodes.map((node) => {
    const width = node.measured?.width ?? node.width ?? 180;
    const height = node.measured?.height ?? node.height ?? 40;
    return { id: node.id, left: node.position.x - width / 2, right: node.position.x + width / 2,
      top: node.position.y, bottom: node.position.y + height };
  });
  const epsilon = 0.01;
  for (let i = 0; i < boxes.length; i++) {
    for (const b of boxes.slice(i + 1)) {
      const a = boxes[i];
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        `overlapping nodes: ${a.id} and ${b.id}`);
    }
  }
  for (const e of edges) {
    const points = e.data?.route?.points;
    assert.ok(points && points.length >= 2, `missing route: ${e.id}`);
    assert.ok(e.markerEnd, `missing direction arrow: ${e.id}`);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      assert.ok([a.x, a.y, b.x, b.y].every(Number.isFinite));
      assert.ok(Math.abs(a.x - b.x) < epsilon || Math.abs(a.y - b.y) < epsilon, `non-orthogonal edge: ${e.id}`);
      for (const box of boxes) {
        const crossing = Math.abs(a.x - b.x) < epsilon
          ? a.x > box.left + epsilon && a.x < box.right - epsilon &&
            Math.max(a.y, b.y) > box.top + epsilon && Math.min(a.y, b.y) < box.bottom - epsilon
          : a.y > box.top + epsilon && a.y < box.bottom - epsilon &&
            Math.max(a.x, b.x) > box.left + epsilon && Math.min(a.x, b.x) < box.right - epsilon;
        assert.equal(crossing, false, `${e.id} crosses ${box.id}`);
      }
    }
    if (e.data?.route?.label) {
      const label = e.data.route.label;
      for (const box of boxes) {
        assert.equal(label.x > box.left && label.x < box.right && label.y > box.top && label.y < box.bottom,
          false, `${e.id} label is inside ${box.id}`);
      }
    }
  }
};

test('screenshot regression: main column is straight and early return is a short local branch', async () => {
  const graph = palindromeGraph();
  const result = await layoutWithElk(graph.nodes, graph.edges);
  const nodes = byId(result.nodes);
  const column = ['start', 'clean', 'len', 'loop', 'left', 'right', 'compare'];
  column.forEach((id, index) => {
    assert.equal(nodes.get(id)!.position.x, nodes.get('loop')!.position.x);
    if (index) assert.ok(nodes.get(id)!.position.y > nodes.get(column[index - 1])!.position.y);
  });
  const earlyReturn = edge(result.edges, 'compare', 'no');
  assert.equal(earlyReturn.type, 'elk');
  assert.equal(earlyReturn.data!.route!.back, false);
  assert.ok(earlyReturn.data!.route!.points.length <= 3, 'early return should need at most one bend');
  assert.equal(earlyReturn.sourceHandle, 'out-right');
  assert.equal(edge(result.edges, 'compare', 'loop').data!.route!.back, true);
  const loopReturn = edge(result.edges, 'compare', 'loop').data!.route!;
  assert.ok(Math.abs(loopReturn.label!.y - loopReturn.points[0].y) < 32,
    'false label must stay near the comparison, not halfway up the long return');
  assertCleanGeometry(result.nodes, result.edges);
});

for (const [name, fixture] of Object.entries({ nested: nestedGraph, branches: branchGraph, jumps: jumpGraph })) {
  test(`${name}: no node overlaps or routes through nodes`, async () => {
    const graph = fixture();
    const result = await layoutWithElk(graph.nodes, graph.edges);
    assertCleanGeometry(result.nodes, result.edges);
    assert.deepEqual(result.edges.map(({ id, source, target, label }) => ({ id, source, target, label })), graph.edges);
  });
}

test('nested loop bodies keep a straight main column', async () => {
  const graph = nestedGraph();
  const result = await layoutWithElk(graph.nodes, graph.edges);
  const nodes = byId(result.nodes);
  const column = ['start', 'outer', 'inner', 'body'];
  column.forEach((id, index) => {
    assert.equal(nodes.get(id)!.position.x, nodes.get('inner')!.position.x);
    if (index) assert.ok(nodes.get(id)!.position.y > nodes.get(column[index - 1])!.position.y);
  });
});

test('routing accounts for existing multiline node heights without resizing them', async () => {
  const graph = palindromeGraph();
  graph.nodes[1].measured = { width: 460, height: 120 };
  graph.nodes[5].measured = { width: 390, height: 84 };
  const result = await layoutWithElk(graph.nodes, graph.edges);
  assertCleanGeometry(result.nodes, result.edges);
  assert.deepEqual(result.nodes.map((node) => node.measured), graph.nodes.map((node) => node.measured));
});

test('does not modify for content, semantic metadata, dimensions, or inputs', async () => {
  const graph = palindromeGraph();
  graph.nodes[3].data.syntaxErrors = [{ symbol: '<', expected: '=' }];
  const before = structuredClone(graph);
  const result = await layoutWithElk(graph.nodes, graph.edges);
  assert.deepEqual(graph, before);
  assert.deepEqual(result.nodes.map(({ id, data, measured, width, height }) => ({ id, data, measured, width, height })),
    before.nodes.map(({ id, data, measured, width, height }) => ({ id, data, measured, width, height })));
  assert.deepEqual(result.edges.map(({ id, source, target, label }) => ({ id, source, target, label })), before.edges);
  assert.equal(result.nodes.length, 9);
  assert.equal(byId(result.nodes).get('loop')!.data.label, 'i < len / 2');
});

test('layouts are stable across re-layout, shuffled arrays, and concurrent calls', async () => {
  const graph = palindromeGraph();
  const first = await layoutWithElk(graph.nodes, graph.edges);
  const [repeat, shuffled] = await Promise.all([
    layoutWithElk(first.nodes, first.edges),
    layoutWithElk([...graph.nodes].reverse(), [...graph.edges].reverse()),
  ]);
  const summarize = (result: typeof first) => ({
    nodes: Object.fromEntries(result.nodes.map((node) => [node.id, node.position])),
    edges: Object.fromEntries(result.edges.map((e) => [e.id, e.data?.route])),
  });
  assert.deepEqual(summarize(first), summarize(repeat));
  assert.deepEqual(summarize(first), summarize(shuffled));
});

test('uses real handle extents so rendered edges consume ELK routes without endpoint mismatches', async () => {
  const graph = palindromeGraph();
  graph.nodes.forEach((node) => {
    const { width, height } = node.measured!;
    node.handles = [
      { id: 'in-top', type: 'target', position: Position.Top, x: width! / 2 - 3, y: -3, width: 6, height: 6 },
      { id: 'in-left', type: 'target', position: Position.Left, x: -3, y: height! / 2 - 3, width: 6, height: 6 },
      { id: 'out-left', type: 'source', position: Position.Left, x: -3, y: height! / 2 - 3, width: 6, height: 6 },
      { id: 'out-bottom', type: 'source', position: Position.Bottom, x: width! / 2 - 3, y: height! - 3, width: 6, height: 6 },
      { id: 'out-right', type: 'source', position: Position.Right, x: width! - 3, y: height! / 2 - 3, width: 6, height: 6 },
    ];
  });
  const result = await layoutWithElk(graph.nodes, graph.edges);
  const nodes = byId(result.nodes);
  for (const e of result.edges) {
    const source = nodes.get(e.source)!;
    const target = nodes.get(e.target)!;
    const start = e.data!.route!.points[0];
    const end = e.data!.route!.points.at(-1)!;
    if (e.sourceHandle === 'out-bottom') {
      assert.equal(start.x, source.position.x);
      assert.equal(start.y, source.position.y + source.measured!.height! + 3);
    } else {
      assert.equal(start.y, source.position.y + source.measured!.height! / 2);
      assert.equal(start.x, source.position.x + (e.sourceHandle === 'out-right' ? 1 : -1) * (source.measured!.width! / 2 + 3));
    }
    if (e.targetHandle === 'in-top') {
      assert.equal(end.x, target.position.x);
      assert.equal(end.y, target.position.y - 3);
    } else {
      assert.equal(end.x, target.position.x - target.measured!.width! / 2 - 3);
      assert.equal(end.y, target.position.y + target.measured!.height! / 2);
    }
  }
  assertCleanGeometry(result.nodes, result.edges);
});

test('self loops, post-tested loops, and disconnected graphs remain drawable', async () => {
  const graph = branchGraph();
  const self = await layoutWithElk([graph.nodes[0], graph.nodes[1], graph.nodes[5]], [
    graph.edges[0], { id: 'self', source: 'test', target: 'test', label: 'true' },
    { id: 'exit', source: 'test', target: 'end', label: 'false' },
  ]);
  assertCleanGeometry(self.nodes, self.edges);
  const doWhile = await layoutWithElk([graph.nodes[0], graph.nodes[2], graph.nodes[1], graph.nodes[5]], [
    { id: 'start', source: 'start', target: 'a' }, { id: 'body', source: 'a', target: 'test' },
    { id: 'back', source: 'test', target: 'a', label: 'true' }, { id: 'exit', source: 'test', target: 'end', label: 'false' },
  ]);
  assert.ok(byId(doWhile.nodes).get('a')!.position.y < byId(doWhile.nodes).get('test')!.position.y);
  assertCleanGeometry(doWhile.nodes, doWhile.edges);
  const isolated = await layoutWithElk(graph.nodes, []);
  assertCleanGeometry(isolated.nodes, isolated.edges);
  assert.deepEqual(await layoutWithElk([], []), { nodes: [], edges: [] });
});

test('bad IDs and missing endpoints are rejected rather than silently dropping connections', async () => {
  const graph = branchGraph();
  await assert.rejects(layoutWithElk(graph.nodes, [{ id: 'bad', source: 'start', target: 'missing' }]), /missing endpoints/);
  await assert.rejects(layoutWithElk([...graph.nodes, graph.nodes[0]], graph.edges), /duplicate IDs/);
});

test('engine failures and incomplete routes propagate to the UI fallback', async () => {
  const graph = branchGraph();
  const failing: LayoutEngine = { layout: async () => { throw new Error('Worker unavailable'); } };
  await assert.rejects(layoutWithElk(graph.nodes, graph.edges, failing), /Worker unavailable/);
  const incomplete: LayoutEngine = { layout: async (input) => ({ ...input,
    children: input.children!.map((node) => ({ ...node, x: 0, y: 0 })),
  }) };
  await assert.rejects(layoutWithElk(graph.nodes, graph.edges, incomplete), /incomplete edge route/);
});

test('a stalled worker times out and is terminated so the UI can fall back', async () => {
  const graph = branchGraph();
  let terminated = false;
  const stalled: LayoutEngine = {
    layout: () => new Promise(() => {}),
    terminateWorker: () => { terminated = true; },
  };
  await assert.rejects(layoutWithElk(graph.nodes, graph.edges, stalled, 10), /timed out/);
  assert.equal(terminated, true);
});
