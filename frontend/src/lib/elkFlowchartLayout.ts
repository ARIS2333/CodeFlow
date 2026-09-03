import { MarkerType } from '@xyflow/react';
import type { ELK, ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api.js';
import { analyzeLoops, NODE_HEIGHT, NODE_WIDTH, type DiagramNode, type DiagramEdge } from './flowchartLayout.ts';

export type LayoutEngine = Pick<ELK, 'layout'> & Partial<Pick<ELK, 'terminateWorker'>>;
let enginePromise: Promise<LayoutEngine> | undefined;

const getEngine = () => {
  enginePromise ??= (async () => {
    // Keep layout work off the UI thread. Node tests use the same bundled
    // algorithm without needing a DOM or a browser worker.
    if (typeof Worker !== 'undefined') {
      const [{ default: Elk }, { default: workerUrl }] = await Promise.all([
        import('elkjs/lib/elk-api.js'),
        import('elkjs/lib/elk-worker.min.js?url'),
      ]);
      return new Elk({ workerUrl });
    }
    const { default: Elk } = await import('elkjs/lib/elk.bundled.js');
    return new Elk();
  })().catch((error: unknown) => {
    enginePromise = undefined;
    throw error;
  });
  return enginePromise;
};

const OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  // Children are in forward control-flow order. This makes ELK break actual
  // back edges, not an arbitrary statement-to-statement edge inside a loop.
  'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
  'elk.layered.feedbackEdges': 'true',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.spacing.nodeNodeBetweenLayers': '56',
  'elk.spacing.nodeNode': '60',
  'elk.spacing.edgeNode': '28',
  'elk.spacing.edgeEdge': '18',
  'elk.layered.mergeEdges': 'false',
  'elk.randomSeed': '1',
};

const compareIds = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const compareEdges = (a: DiagramEdge, b: DiagramEdge) =>
  compareIds(a.source, b.source) || compareIds(a.target, b.target) || compareIds(a.id, b.id);

const nodeSize = (node: DiagramNode) => ({
  width: node.measured?.width ?? node.width ?? NODE_WIDTH,
  height: node.measured?.height ?? node.height ?? NODE_HEIGHT,
});

/** Stable topological order of the forward graph, without changing real edges. */
const forwardOrder = (nodes: DiagramNode[], edges: DiagramEdge[], backEdges: Set<string>) => {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.filter((edge) => !backEdges.has(edge.id)).forEach((edge) => {
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
    outgoing.get(edge.source)!.push(edge.target);
  });
  const ready = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id).sort(compareIds);
  const result: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    result.push(id);
    outgoing.get(id)!.forEach((target) => {
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) ready.push(target);
    });
    ready.sort(compareIds);
  }
  if (result.length !== nodes.length) throw new Error('Unable to order the forward graph');
  return result;
};

const makePorts = (id: string, node: DiagramNode, width: number, height: number): ElkPort[] => {
  if (node.handles?.length) {
    const side = { top: 'NORTH', bottom: 'SOUTH', left: 'WEST', right: 'EAST' };
    return node.handles.map((handle) => {
      const portWidth = handle.width ?? 6;
      const portHeight = handle.height ?? 6;
      // FIXED_POS fixes the tangential coordinate only. React Flow handles
      // straddle the border; ELK otherwise moves them fully outside the node.
      const borderOffset = {
        top: -handle.y - portHeight,
        bottom: handle.y - height,
        left: -handle.x - portWidth,
        right: handle.x - width,
      }[handle.position];
      return {
        id: `${id}:${handle.id}`,
        x: handle.x, y: handle.y, width: portWidth, height: portHeight,
        layoutOptions: {
          'elk.port.side': side[handle.position],
          'elk.port.borderOffset': String(borderOffset),
        },
      };
    });
  }
  return [
    { id: `${id}:in-top`, x: width / 2, y: 0, layoutOptions: { 'elk.port.side': 'NORTH' } },
    { id: `${id}:in-left`, x: 0, y: height / 2, layoutOptions: { 'elk.port.side': 'WEST' } },
    { id: `${id}:out-left`, x: 0, y: height / 2, layoutOptions: { 'elk.port.side': 'WEST' } },
    { id: `${id}:out-bottom`, x: width / 2, y: height, layoutOptions: { 'elk.port.side': 'SOUTH' } },
    { id: `${id}:out-right`, x: width, y: height / 2, layoutOptions: { 'elk.port.side': 'EAST' } },
  ].map((port) => ({ ...port, width: 0, height: 0 }));
};

/** Layout only: never add, remove, rename, or reconnect a semantic node/edge. */
export const layoutWithElk = async (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  engine?: LayoutEngine,
  timeoutMs = 15_000,
): Promise<{ nodes: DiagramNode[]; edges: DiagramEdge[] }> => {
  if (!nodes.length && !edges.length) return { nodes: [], edges: [] };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length || new Set(edges.map((edge) => edge.id)).size !== edges.length ||
    edges.some((edge) => !byId.has(edge.source) || !byId.has(edge.target))) {
    throw new Error('Cannot lay out a graph with duplicate IDs or missing endpoints');
  }
  const { loops, backEdgeIds } = analyzeLoops(nodes, edges);
  const order = forwardOrder(nodes, edges, backEdgeIds);
  const elkIds = new Map(order.map((id, index) => [id, `node${index}`]));
  const sortedEdges = [...edges].sort(compareEdges);
  const primary = new Set<string>();
  for (const id of order) {
    const outgoing = sortedEdges.filter((edge) => edge.source === id);
    const forward = outgoing.filter((edge) => !backEdgeIds.has(edge.id));
    const loop = loops.find((candidate) => candidate.members.has(id));
    const score = (edge: DiagramEdge) => {
      if (loop?.members.has(edge.target)) return 2;
      return ['terminal', 'end'].includes(byId.get(edge.target)!.data.kind ?? '') ? 0 : 1;
    };
    forward.sort((a, b) => score(b) - score(a) || compareEdges(a, b));
    // A condition returning to the loop is not automatically a do-while test.
    // Its other branch can be a nearby early return, not a loop-wide exit wire.
    if (forward[0] && !(outgoing.some((edge) => backEdgeIds.has(edge.id)) && score(forward[0]) === 0)) {
      primary.add(forward[0].id);
    }
  }
  const ports = new Map(sortedEdges.map((edge) => {
    const back = backEdgeIds.has(edge.id);
    return [edge.id, {
      source: back ? (edge.source === edge.target ? 'out-bottom' : 'out-left')
        : primary.has(edge.id) ? 'out-bottom' : 'out-right',
      target: back ? 'in-left' : 'in-top',
    }];
  }));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: OPTIONS,
    children: order.map((id) => {
      const size = nodeSize(byId.get(id)!);
      if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
        throw new Error('Cannot lay out a node without positive dimensions');
      }
      const elkId = elkIds.get(id)!;
      return {
        id: elkId,
        ...size,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: makePorts(elkId, byId.get(id)!, size.width, size.height),
      };
    }),
    edges: sortedEdges.map((edge, index) => ({
      id: `edge${index}`,
      sources: [`${elkIds.get(edge.source)}:${ports.get(edge.id)!.source}`],
      targets: [`${elkIds.get(edge.target)}:${ports.get(edge.id)!.target}`],
      layoutOptions: { 'elk.layered.priority.straightness': primary.has(edge.id) ? '100' : '1' },
      labels: typeof edge.label === 'string' && edge.label ? [{
        text: edge.label,
        width: Math.max(24, edge.label.length * 7),
        height: 16,
        layoutOptions: { 'elk.edgeLabels.placement': 'TAIL' },
      }] : [],
    })),
  };
  const pendingEngine = engine ? Promise.resolve(engine) : getEngine();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    pendingEngine.then((elk) => elk.layout(graph)),
    new Promise<ElkNode>((_, reject) => {
      timer = setTimeout(() => {
        // Worker loading/runtime failures can otherwise leave its promises
        // pending forever. Let the UI fall back and the next retry start fresh.
        if (enginePromise === pendingEngine) enginePromise = undefined;
        reject(new Error('Automatic layout timed out'));
        void pendingEngine.then((elk) => elk.terminateWorker?.()).catch(() => {});
      }, timeoutMs);
    }),
  ]).finally(() => { clearTimeout(timer); });
  const placed = new Map(result.children?.map((node) => [node.id, node]));
  const routed = new Map(result.edges?.map((edge) => [edge.id, edge]));
  const placedNodes = nodes.map((node): DiagramNode => {
    const position = placed.get(elkIds.get(node.id)!);
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new Error('The layout engine returned an invalid node position');
    }
    return {
      ...node,
      type: 'custom',
      origin: [0.5, 0],
      position: { x: position.x! + nodeSize(node).width / 2, y: position.y! },
    };
  });
  const edgeResults = new Map(sortedEdges.map((edge, index) => {
    const route = routed.get(`edge${index}`);
    const section = route?.sections?.[0];
    if (!section || route!.sections!.length !== 1) throw new Error('The layout engine returned an incomplete edge route');
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new Error('The layout engine returned invalid edge coordinates');
    }
    const label = route?.labels?.[0];
    const loop = loops.find((candidate) => candidate.backEdges.some((back) => back.id === edge.id));
    return [edge.id, {
      ...edge,
      type: 'elk',
      sourceHandle: ports.get(edge.id)!.source,
      targetHandle: ports.get(edge.id)!.target,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b', width: 16, height: 16 },
      style: { ...edge.style, stroke: '#64748b', strokeWidth: 1.5 },
      data: {
        ...edge.data,
        loop: loop ? { nodeIds: [...loop.members], lane: loops.indexOf(loop) } : undefined,
        route: {
          points,
          back: backEdgeIds.has(edge.id),
          label: label && Number.isFinite(label.x) && Number.isFinite(label.y)
            ? { x: label.x! + label.width! / 2, y: label.y! + label.height! / 2 } : undefined,
        },
      },
    } satisfies DiagramEdge];
  }));
  return { nodes: placedNodes, edges: edges.map((edge) => edgeResults.get(edge.id)!) };
};
