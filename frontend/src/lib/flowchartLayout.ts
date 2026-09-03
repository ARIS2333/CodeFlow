import dagre from 'dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { FlowchartNodeKind, SyntaxErrorMark } from './llmSchemas';

// Keep the existing sizing policy; this module only changes graph placement.
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 40;

export interface FlowchartNodeData extends Record<string, unknown> {
  label: string;
  kind?: FlowchartNodeKind;
  syntaxErrors?: SyntaxErrorMark[];
}

export interface LoopRoute {
  nodeIds: string[];
  lane: number;
}

export interface FlowchartEdgeData extends Record<string, unknown> {
  loop?: LoopRoute;
  route?: {
    points: Array<{ x: number; y: number }>;
    label?: { x: number; y: number };
    back: boolean;
  };
}

export type DiagramNode = Node<FlowchartNodeData>;
export type DiagramEdge = Edge<FlowchartEdgeData>;

interface NaturalLoop {
  header: string;
  members: Set<string>;
  backEdges: DiagramEdge[];
}

const compareIds = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const compareEdges = (a: DiagramEdge, b: DiagramEdge) =>
  compareIds(a.source, b.source) || compareIds(a.target, b.target) || compareIds(a.id, b.id);

/** Identify natural loops using dominance, not labels or the order of node IDs. */
export const analyzeLoops = (nodes: DiagramNode[], edges: DiagramEdge[]) => {
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map([...ids].map((id) => [id, [] as DiagramEdge[]]));
  const incoming = new Map([...ids].map((id) => [id, [] as DiagramEdge[]]));
  const validEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  [...validEdges].sort(compareEdges).forEach((edge) => {
    outgoing.get(edge.source)!.push(edge);
    incoming.get(edge.target)!.push(edge);
  });

  const start = nodes.find((node) => node.data.kind === 'start')?.id
    ?? nodes.find((node) => incoming.get(node.id)!.length === 0)?.id
    ?? nodes[0]?.id;
  const reachable = new Set<string>();
  const pending = start ? [start] : [];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    outgoing.get(id)?.forEach((edge) => pending.push(edge.target));
  }

  const dominators = new Map([...reachable].map((id) => [
    id, id === start ? new Set([id]) : new Set(reachable),
  ]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of reachable) {
      if (id === start) continue;
      const predecessors = incoming.get(id)!.filter((edge) => reachable.has(edge.source));
      const common = new Set(dominators.get(predecessors[0].source));
      for (const edge of predecessors.slice(1)) {
        for (const candidate of common) {
          if (!dominators.get(edge.source)!.has(candidate)) common.delete(candidate);
        }
      }
      common.add(id);
      const previous = dominators.get(id)!;
      if (common.size !== previous.size || [...common].some((item) => !previous.has(item))) {
        dominators.set(id, common);
        changed = true;
      }
    }
  }

  const backEdgeIds = new Set<string>();
  const byHeader = new Map<string, NaturalLoop>();
  for (const edge of [...validEdges].sort(compareEdges)) {
    if (!dominators.get(edge.source)?.has(edge.target)) continue;
    backEdgeIds.add(edge.id);
    const loop = byHeader.get(edge.target) ?? {
      header: edge.target, members: new Set([edge.target]), backEdges: [],
    };
    loop.backEdges.push(edge);
    const ancestors = [edge.source];
    while (ancestors.length) {
      const id = ancestors.pop()!;
      if (loop.members.has(id)) continue;
      loop.members.add(id);
      incoming.get(id)!.forEach((predecessor) => {
        if (dominators.get(predecessor.source)?.has(loop.header)) {
          ancestors.push(predecessor.source);
        }
      });
    }
    byHeader.set(loop.header, loop);
  }

  // Malformed/recovered graphs can contain irreducible cycles. Break any
  // remaining cycles only in the layout projection, preserving every real edge.
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (backEdgeIds.has(edge.id)) continue;
      if (active.has(edge.target)) backEdgeIds.add(edge.id);
      else visit(edge.target);
    }
    active.delete(id);
  };
  if (start) visit(start);
  [...ids].sort(compareIds).forEach(visit);

  return {
    backEdgeIds,
    loops: [...byHeader.values()].sort((a, b) =>
      a.members.size - b.members.size || compareIds(a.header, b.header)),
  };
};

export const layoutFlowchart = (nodes: DiagramNode[], edges: DiagramEdge[]) => {
  const { loops, backEdgeIds } = analyzeLoops(nodes, edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const exitLoops = new Map<string, NaturalLoop>();
  for (const edge of edges) {
    if (backEdgeIds.has(edge.id)) continue;
    // The test is the header for while/for, but the latch for do-while.
    const loop = loops.find((candidate) =>
      !candidate.members.has(edge.target) && (
        candidate.header === edge.source || (
          nodeById.get(edge.source)?.data.kind === 'condition' &&
          candidate.backEdges.some((back) => back.source === edge.source)
        )
      ));
    if (loop) exitLoops.set(edge.id, loop);
  }

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph(backEdgeIds.size
    ? { rankdir: 'TB', align: 'UL', ranksep: 64, nodesep: 64 }
    : { rankdir: 'TB' });
  [...nodes].sort((a, b) => compareIds(a.id, b.id)).forEach((node) => {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  const isInsideLoop = (edge: DiagramEdge) => loops.some((loop) =>
    loop.members.has(edge.source) && loop.members.has(edge.target));
  const forward = edges.filter((edge) => !backEdgeIds.has(edge.id));
  forward.sort((a, b) =>
    Number(isInsideLoop(b)) - Number(isInsideLoop(a)) || compareEdges(a, b));
  for (const edge of forward) {
    if (exitLoops.has(edge.id)) continue;
    graph.setEdge(edge.source, edge.target, { weight: isInsideLoop(edge) ? 8 : 1 }, edge.id);
  }

  const hasPath = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length) {
      const id = queue.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(graph.outEdges(id) ?? []).map((edge) => edge.w));
    }
    return false;
  };
  // Put the continuation after the loop body instead of beside its first
  // statement. These are layout-only dependencies, never rendered as edges.
  for (const edge of forward.filter((item) => exitLoops.has(item.id))) {
    const loop = exitLoops.get(edge.id)!;
    const latches = [...new Set(loop.backEdges.map((back) => back.source))];
    if (latches.every((id) => !hasPath(edge.target, id))) {
      latches.forEach((id) => graph.setEdge(id, edge.target, { weight: 8 }, `exit:${edge.id}:${id}`));
    } else {
      graph.setEdge(edge.source, edge.target, {}, edge.id);
    }
  }
  dagre.layout(graph);

  const routeMembers = (edge: DiagramEdge) => loops.find((loop) =>
    loop.backEdges.some((back) => back.id === edge.id))?.members;
  const backEdges = edges.filter((edge) => backEdgeIds.has(edge.id)).sort((a, b) =>
    (routeMembers(a)?.size ?? nodes.length) - (routeMembers(b)?.size ?? nodes.length)
    || compareEdges(a, b));

  return {
    nodes: nodes.map((node): DiagramNode => ({
      ...node,
      type: 'custom',
      // Align the centers of the flow's main column, without resizing nodes.
      origin: [0.5, 0],
      position: { x: graph.node(node.id).x, y: graph.node(node.id).y - NODE_HEIGHT / 2 },
    })),
    edges: edges.map((edge): DiagramEdge => {
      const back = backEdgeIds.has(edge.id);
      const exitLoop = exitLoops.get(edge.id);
      const members = back ? routeMembers(edge) : exitLoop?.members;
      return {
        ...edge,
        type: back ? 'loop-back' : exitLoop ? 'loop-exit' : 'smoothstep',
        sourceHandle: back && edge.source !== edge.target && nodeById.get(edge.source)?.data.kind === 'condition'
          ? 'out-left' : exitLoop ? 'out-right' : 'out-bottom',
        targetHandle: back ? 'in-left' : 'in-top',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b', width: 16, height: 16 },
        style: { ...edge.style, stroke: '#64748b', strokeWidth: 1.5 },
        data: {
          ...edge.data,
          loop: back || exitLoop ? {
            nodeIds: [...(members ?? new Set([edge.source, edge.target]))],
            // Inner loops get the closest lane, outer loops travel farther out.
            lane: back ? backEdges.findIndex((item) => item.id === edge.id) : loops.indexOf(exitLoop!),
          } : undefined,
        },
      };
    }),
  };
};
