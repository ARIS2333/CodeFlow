import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analyzeLoops, layoutFlowchart, type DiagramNode, type DiagramEdge } from '../src/lib/flowchartLayout.ts';
import { roundedPath, routeLoopBack, routeLoopExit, type NodeBounds, type Point } from '../src/lib/loopRouting.ts';

const node = (id: string, kind: DiagramNode['data']['kind'] = 'process', label = id): DiagramNode => ({
  id, data: { kind, label }, position: { x: 0, y: 0 },
});
const edge = (source: string, target: string, label?: string): DiagramEdge => ({
  id: `${source}-${target}`, source, target, label,
});
const whileGraph = () => ({
  nodes: [node('start', 'start'), node('test', 'condition', 'while (x > revertedNumber)'),
    node('assign', 'process', 'revertedNumber = revertedNumber * 10 + x % 10;'),
    node('update', 'process', 'x /= 10;'), node('return', 'terminal')],
  edges: [edge('start', 'test'), edge('test', 'assign', 'true'), edge('assign', 'update'),
    edge('update', 'test'), edge('test', 'return', 'false')],
});
const findEdge = (edges: DiagramEdge[], source: string, target: string) =>
  edges.find((item) => item.source === source && item.target === target)!;
const positions = (nodes: DiagramNode[]) => Object.fromEntries(nodes.map((item) => [item.id, item.position]));

test('while body stays in a vertical column, with an outer return and a separate exit', () => {
  const input = whileGraph();
  const result = layoutFlowchart(input.nodes, input.edges);
  const p = positions(result.nodes);
  assert.equal(p.test.x, p.assign.x);
  assert.equal(p.assign.x, p.update.x);
  assert.ok(p.test.y < p.assign.y && p.assign.y < p.update.y && p.update.y < p.return.y);
  const back = findEdge(result.edges, 'update', 'test');
  assert.equal(back.type, 'loop-back');
  assert.equal(back.sourceHandle, 'out-bottom');
  assert.equal(back.targetHandle, 'in-left');
  const exit = findEdge(result.edges, 'test', 'return');
  assert.equal(exit.type, 'loop-exit');
  assert.equal(exit.sourceHandle, 'out-right');
  assert.equal(exit.targetHandle, 'in-top');
  assert.equal(exit.label, 'false');
  assert.ok(result.edges.every((item) => item.markerEnd));
});

test('cycle detection uses topology even with arbitrary IDs or missing/misleading labels', () => {
  const input = whileGraph();
  input.edges[0].label = 'loop-back'; // Not actually a cycle.
  const result = analyzeLoops(input.nodes, input.edges);
  assert.deepEqual([...result.backEdgeIds], ['update-test']);
  assert.deepEqual([...result.loops[0].members].sort(), ['assign', 'test', 'update']);
});

test('for continue keeps its jump to the update step before returning to the test', () => {
  const nodes = [node('start', 'start'), node('init'), node('test', 'condition'),
    node('skip?', 'condition'), node('continue'), node('body'), node('i++'), node('end', 'end')];
  const edges = [edge('start', 'init'), edge('init', 'test'), edge('test', 'skip?', 'true'),
    edge('skip?', 'continue', 'true'), edge('continue', 'i++'), edge('skip?', 'body', 'false'),
    edge('body', 'i++'), edge('i++', 'test'), edge('test', 'end', 'false')];
  const result = layoutFlowchart(nodes, edges);
  const continuation = findEdge(result.edges, 'continue', 'i++');
  assert.equal(continuation.type, 'smoothstep');
  assert.equal(findEdge(result.edges, 'i++', 'test').type, 'loop-back');
  const p = positions(result.nodes);
  assert.ok(p['i++'].y > p.continue.y && p['i++'].y > p.body.y);
  assert.ok(p.end.y > p['i++'].y);
  assert.equal(result.edges.some((item) => item.source === 'continue' && item.target === 'test'), false);
});

test('do-while runs the body before the test and returns to the body rather than to itself', () => {
  const nodes = [node('start', 'start'), node('body'), node('test', 'condition'), node('end', 'end')];
  const edges = [edge('start', 'body'), edge('body', 'test'),
    edge('test', 'body', 'true'), edge('test', 'end', 'false')];
  const result = layoutFlowchart(nodes, edges);
  const p = positions(result.nodes);
  assert.ok(p.body.y < p.test.y && p.test.y < p.end.y);
  assert.equal(findEdge(result.edges, 'test', 'body').type, 'loop-back');
  assert.equal(findEdge(result.edges, 'test', 'body').sourceHandle, 'out-left');
  assert.equal(findEdge(result.edges, 'test', 'body').label, 'true');
  assert.equal(findEdge(result.edges, 'test', 'end').type, 'loop-exit');
});

test('nested loops use different lanes, with the outer return farther away', () => {
  const nodes = [node('start', 'start'), node('outer', 'condition'), node('inner', 'condition'),
    node('body'), node('outerUpdate'), node('end', 'end')];
  const edges = [edge('start', 'outer'), edge('outer', 'inner', 'true'), edge('inner', 'body', 'true'),
    edge('body', 'inner'), edge('inner', 'outerUpdate', 'false'), edge('outerUpdate', 'outer'),
    edge('outer', 'end', 'false')];
  const result = layoutFlowchart(nodes, edges);
  const inner = findEdge(result.edges, 'body', 'inner').data!.loop!;
  const outer = findEdge(result.edges, 'outerUpdate', 'outer').data!.loop!;
  assert.ok(inner.lane < outer.lane);
  assert.equal(inner.nodeIds.includes('outer'), false);
  assert.ok(outer.nodeIds.includes('inner'));
  const p = positions(result.nodes);
  assert.ok(p.body.y < p.outerUpdate.y && p.outerUpdate.y < p.end.y);
});

test('break and early return stay exits; only continue and the latch route back', () => {
  const nodes = [node('start', 'start'), node('head', 'condition'), node('c1', 'condition'),
    node('c2', 'condition'), node('c3', 'condition'), node('break'), node('continue'),
    node('return', 'terminal'), node('body'), node('end', 'end')];
  const edges = [edge('start', 'head'), edge('head', 'c1', 'true'), edge('head', 'end', 'false'),
    edge('c1', 'break', 'true'), edge('break', 'end'), edge('c1', 'c2', 'false'),
    edge('c2', 'continue', 'true'), edge('continue', 'head'), edge('c2', 'c3', 'false'),
    edge('c3', 'return', 'true'), edge('c3', 'body', 'false'), edge('body', 'head')];
  const result = layoutFlowchart(nodes, edges);
  assert.equal(findEdge(result.edges, 'break', 'end').type, 'smoothstep');
  assert.equal(findEdge(result.edges, 'continue', 'head').type, 'loop-back');
  assert.equal(findEdge(result.edges, 'body', 'head').type, 'loop-back');
  assert.notEqual(findEdge(result.edges, 'continue', 'head').data!.loop!.lane,
    findEdge(result.edges, 'body', 'head').data!.loop!.lane);
  assert.equal(result.edges.some((item) => item.source === 'return'), false);
});

test('empty/self loops use different entry and departure ports', () => {
  const nodes = [node('start', 'start'), node('head', 'condition'), node('end', 'end')];
  const edges = [edge('start', 'head'), edge('head', 'head', 'true'), edge('head', 'end', 'false')];
  const result = layoutFlowchart(nodes, edges);
  const back = findEdge(result.edges, 'head', 'head');
  assert.equal(back.type, 'loop-back');
  assert.equal(back.sourceHandle, 'out-bottom');
  assert.equal(back.targetHandle, 'in-left');
  assert.ok(positions(result.nodes).end.y > positions(result.nodes).head.y);
});

test('irreducible cycles still get a return route without inventing a natural loop', () => {
  const nodes = [node('start', 'start'), node('fork', 'condition'), node('a'), node('b')];
  const edges = [edge('start', 'fork'), edge('fork', 'a', 'true'), edge('fork', 'b', 'false'),
    edge('a', 'b'), edge('b', 'a')];
  const analysis = analyzeLoops(nodes, edges);
  assert.equal(analysis.loops.length, 0);
  assert.equal(analysis.backEdgeIds.size, 1);
  const result = layoutFlowchart(nodes, edges);
  assert.equal(result.edges.filter((item) => item.type === 'loop-back').length, 1);
  assert.equal(result.edges.length, edges.length);
  assert.ok(result.nodes.every((item) => Number.isFinite(item.position.x) && Number.isFinite(item.position.y)));
});

test('layout preserves semantic edges, labels, syntax markings and node dimensions', () => {
  const input = whileGraph();
  input.nodes[2].data.syntaxErrors = [{ symbol: ';', expected: ')' }];
  input.nodes[2].width = 333;
  input.nodes[2].height = 77;
  const original = structuredClone(input);
  const result = layoutFlowchart(input.nodes, input.edges);
  assert.deepEqual(input, original);
  assert.deepEqual(result.edges.map(({ id, source, target, label }) => ({ id, source, target, label })), original.edges);
  assert.deepEqual(result.nodes.map(({ id, data, width, height }) => ({ id, data, width, height })),
    original.nodes.map(({ id, data, width, height }) => ({ id, data, width, height })));
});

test('re-layout and shuffled input produce stable positions and return lanes', () => {
  const input = whileGraph();
  const first = layoutFlowchart(input.nodes, input.edges);
  const repeated = layoutFlowchart(first.nodes, first.edges);
  const shuffled = layoutFlowchart([...input.nodes].reverse(), [...input.edges].reverse());
  assert.deepEqual(positions(repeated.nodes), positions(first.nodes));
  assert.deepEqual(positions(shuffled.nodes), positions(first.nodes));
  assert.deepEqual(findEdge(shuffled.edges, 'update', 'test').data, findEdge(first.edges, 'update', 'test').data);
});

test('acyclic branches have no invented loop routes; an empty graph is safe', () => {
  const nodes = [node('start', 'start'), node('if', 'condition'), node('left', 'terminal'), node('right', 'terminal')];
  const edges = [edge('start', 'if'), edge('if', 'left', 'true'), edge('if', 'right', 'false')];
  assert.ok(layoutFlowchart(nodes, edges).edges.every((item) => item.type === 'smoothstep'));
  assert.deepEqual(layoutFlowchart([], []), { nodes: [], edges: [] });
});

// Routing assertions examine the orthogonal segments, not just a path snapshot.
const assertAvoidsNodes = (points: Point[], bounds: NodeBounds[]) => {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    assert.ok(a.x === b.x || a.y === b.y, 'segments must be orthogonal');
    for (const box of bounds) {
      const crosses = a.x === b.x
        ? a.x > box.left && a.x < box.right && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom
        : a.y > box.top && a.y < box.bottom && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right;
      assert.equal(crosses, false, 'edge must not run through a node');
    }
  }
};
const boxes = [
  { left: 100, right: 280, top: 0, bottom: 40 },
  { left: 100, right: 280, top: 104, bottom: 144 },
  { left: 100, right: 280, top: 208, bottom: 248 },
  { left: 100, right: 280, top: 312, bottom: 352 },
];

test('the return route wraps outside the body and approaches the test from its left', () => {
  const route = routeLoopBack({ source: { x: 190, y: 248 }, target: { x: 100, y: 20 }, bounds: boxes, lane: 0 });
  assertAvoidsNodes(route.points, boxes);
  assert.ok(route.points[2].x < 100);
  assert.equal(route.points.at(-2)!.y, 20);
  assert.ok(route.points.at(-2)!.x < route.points.at(-1)!.x);
  assert.match(route.path, /Q/);
  assert.doesNotMatch(route.path, /NaN|Infinity/);
});

test('the false exit goes around the right of the body, entering the continuation from above', () => {
  const route = routeLoopExit({ source: { x: 280, y: 20 }, target: { x: 190, y: 312 }, bounds: boxes, lane: 0 });
  assertAvoidsNodes(route.points, boxes);
  assert.ok(route.points[1].x > 280);
  assert.equal(route.points.at(-2)!.x, 190);
  assert.ok(route.points.at(-2)!.y < route.points.at(-1)!.y);
});

test('nested lanes remain separated and routes update when bounds move', () => {
  const options = { source: { x: 190, y: 248 }, target: { x: 100, y: 20 }, bounds: boxes, lane: 0 };
  const inner = routeLoopBack(options);
  const outer = routeLoopBack({ ...options, lane: 1 });
  assert.ok(outer.labelX < inner.labelX);
  const moved = routeLoopBack({ ...options, bounds: [...boxes, { left: 0, right: 80, top: 100, bottom: 140 }] });
  assert.ok(moved.labelX < inner.labelX);
});

test('self-loop and conditional-return paths are non-degenerate', () => {
  const self = routeLoopBack({ source: { x: 190, y: 40 }, target: { x: 100, y: 20 }, bounds: [boxes[0]], lane: 0 });
  assertAvoidsNodes(self.points, [boxes[0]]);
  const conditional = routeLoopBack({ source: { x: 100, y: 228 }, target: { x: 100, y: 20 },
    bounds: boxes, lane: 0, fromLeft: true });
  assertAvoidsNodes(conditional.points, boxes);
  assert.doesNotMatch(conditional.path, /NaN|Infinity/);
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 0 }]), '');
});
