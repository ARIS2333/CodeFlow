import { useCallback, useContext, useEffect, useRef, memo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodesInitialized,
  Handle,
  Position,
} from '@xyflow/react';
import { LoopBackEdge, LoopExitEdge } from './FlowchartLoopEdge';
import { FlowchartRoutedEdge } from './FlowchartRoutedEdge';
import { layoutWithElk } from './lib/elkFlowchartLayout';
import {
  layoutFlowchart,
  type FlowchartNodeData,
  type DiagramNode,
  type DiagramEdge,
} from './lib/flowchartLayout';
import { TraceHighlightContext, type TraceHighlight } from './lib/traceHighlight';
import '@xyflow/react/dist/style.css';

const traceNodeClasses = (
  { activeNodeId, visitedNodeIds }: TraceHighlight,
  id: string
): string => {
  if (!activeNodeId) return 'bg-white border-stone-400';
  if (activeNodeId === id) return 'bg-blue-50 border-blue-600 ring-2 ring-blue-300';
  if (visitedNodeIds?.has(id)) return 'bg-blue-50/70 border-blue-400';
  // Not reached on this input. Dimmed, not hidden: an unvisited branch is
  // itself something worth noticing.
  return 'bg-white border-stone-300 opacity-40';
};

interface FlowchartDiagramProps {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  highlight?: TraceHighlight;
  heightClassName?: string;
}

// A logic mistake is never marked here: the student finds it by comparing their
// flow against the recommended one. A missing token is also not blamed on a
// nearby valid token; the badge only says that the parser located a problem near
// this recovered step.
const CustomNode = memo(({ id, data }: { id: string; data: FlowchartNodeData }) => {
  const { label, syntaxErrors } = data;
  const syntaxWarning = syntaxErrors?.length
    ? syntaxErrors.map(({ expected }) => expected ? `Expected ${expected}` : 'Source error').join('; ')
    : undefined;
  const highlight = useContext(TraceHighlightContext);

  return (
    <div
      className={`px-4 py-2 shadow-md rounded-md border-2 transition-colors ${traceNodeClasses(highlight, id)}`}
    >
      <div className="flex flex-col">
        <div className="text-sm font-medium whitespace-pre-wrap text-gray-900">{label}</div>
        {syntaxWarning && (
          <div
            title={syntaxWarning}
            aria-label={`Syntax issue near this step: ${syntaxWarning}`}
            className="mt-1 flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900"
          >
            <span aria-hidden="true">⚠</span>
            <span>Syntax issue near this step</span>
          </div>
        )}
      </div>
      <Handle
        id="in-top"
        type="target"
        position={Position.Top}
        className="w-16 !bg-teal-500"
      />
      <Handle
        id="out-bottom"
        type="source"
        position={Position.Bottom}
        className="w-16 !bg-teal-500"
      />
      <Handle id="in-left" type="target" position={Position.Left} className="!bg-teal-500" />
      <Handle id="out-left" type="source" position={Position.Left} className="!bg-teal-500" />
      <Handle id="out-right" type="source" position={Position.Right} className="!bg-teal-500" />
    </div>
  );
});

// Define custom node types
const nodeTypes = {
  custom: CustomNode,
};

const edgeTypes = {
  elk: FlowchartRoutedEdge,
  'loop-back': LoopBackEdge,
  'loop-exit': LoopExitEdge,
};

// Inner component that uses React Flow hooks
const FlowchartDiagramInner = ({ nodes, edges }: Omit<FlowchartDiagramProps, 'highlight'>) => {
  const { fitView, getNodes, getInternalNode } = useReactFlow<DiagramNode, DiagramEdge>();
  const [flowNodes, setNodes, onNodesChange] = useNodesState<DiagramNode>([]);
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState<DiagramEdge>([]);
  const nodesInitialized = useNodesInitialized();
  const [phase, setPhase] = useState<'measuring' | 'layout' | 'ready'>('measuring');
  const [hasLayout, setHasLayout] = useState(false);
  const [layoutWarning, setLayoutWarning] = useState<string | null>(null);
  const requestVersion = useRef({ value: 0 });
  const fitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeFitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mount unchanged node contents first so ELK can read their existing sizes.
  // This does not resize nodes or alter the viewport's fit policy.
  useEffect(() => {
    const version = requestVersion.current;
    version.value++;
    if (fitTimer.current) clearTimeout(fitTimer.current);
    setNodes(nodes.map((node) => ({ ...node, type: 'custom', origin: [0.5, 0] })));
    setEdges([]);
    setHasLayout(nodes.length === 0);
    setLayoutWarning(null);
    setPhase(nodes.length ? 'measuring' : 'ready');
    return () => {
      version.value++;
      if (fitTimer.current) clearTimeout(fitTimer.current);
    };
  }, [nodes, edges, setNodes, setEdges]);

  const onLayout = useCallback(async () => {
    const ticket = ++requestVersion.current.value;
    const currentNodes = getNodes().map((node) => {
      const handles = getInternalNode(node.id)?.internals.handleBounds;
      return handles ? { ...node, handles: [
        ...(handles.source ?? []).map((handle) => ({ ...handle, type: 'source' as const })),
        ...(handles.target ?? []).map((handle) => ({ ...handle, type: 'target' as const })),
      ] } : node;
    });
    setPhase('layout');
    setLayoutWarning(null);
    let result;
    try {
      result = await layoutWithElk(currentNodes, edges);
    } catch (error: unknown) {
      if (ticket !== requestVersion.current.value) return;
      console.warn('ELK layout unavailable; using the basic layout:', error);
      result = layoutFlowchart(currentNodes, edges);
      setLayoutWarning('Using basic layout because automatic routing is unavailable.');
    }
    // A slow layout must not overwrite a newly generated graph or a closed panel.
    if (ticket !== requestVersion.current.value) return;
    setNodes(result.nodes);
    setEdges(result.edges);
    setHasLayout(true);
    setPhase('ready');
    if (fitTimer.current) clearTimeout(fitTimer.current);
    fitTimer.current = setTimeout(() => {
      if (ticket === requestVersion.current.value) void fitView();
    }, 100);
  }, [edges, getNodes, getInternalNode, fitView, setNodes, setEdges]);

  useEffect(() => {
    if (!nodesInitialized || phase !== 'measuring') return;
    const frame = requestAnimationFrame(() => { void onLayout(); });
    return () => cancelAnimationFrame(frame);
  }, [nodesInitialized, phase, onLayout]);

  // A full-screen or window-size change alters the available canvas. Re-fit
  // the already-laid-out graph so the whole path remains visible immediately.
  useEffect(() => {
    if (!hasLayout || !containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (resizeFitTimer.current) clearTimeout(resizeFitTimer.current);
      resizeFitTimer.current = setTimeout(() => { void fitView(); }, 80);
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      if (resizeFitTimer.current) clearTimeout(resizeFitTimer.current);
    };
  }, [fitView, hasLayout]);

  return (
    <div ref={containerRef} className="relative h-full">
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={phase === 'ready'}
      style={{ opacity: hasLayout ? 1 : 0 }}
      fitView
      minZoom={0.01}
      fitViewOptions={{ minZoom: 0.01 }}
      proOptions={{ hideAttribution: true }}
      className="bg-teal-50"
    >
      <Controls showInteractive={false} />
      {layoutWarning && <Panel position="bottom-left">
        <p role="status" className="rounded bg-amber-50 p-2 text-xs text-amber-800">{layoutWarning}</p>
      </Panel>}
    </ReactFlow>
    {!hasLayout && <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-gray-600">
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600" />
      Arranging flowchart...
    </div>}
    </div>
  );
};

const EMPTY_HIGHLIGHT: TraceHighlight = {};

// Main component that provides the React Flow context
const FlowchartDiagram = ({ nodes, edges, highlight, heightClassName = 'h-[500px]' }: FlowchartDiagramProps) => {
  return (
    <div className={`w-full ${heightClassName}`}>
      <TraceHighlightContext.Provider value={highlight ?? EMPTY_HIGHLIGHT}>
        <ReactFlowProvider>
          <FlowchartDiagramInner nodes={nodes} edges={edges} />
        </ReactFlowProvider>
      </TraceHighlightContext.Provider>
    </div>
  );
};

// // Example usage with sample data
// const ExampleFlowchart = () => {
//   const sampleNodes = [
//     {
//       id: '1',
//       data: { 
//         label: 'Start Process',
//         hasError: false 
//       },
//       position: { x: 0, y: 0 }
//     },
//     {
//       id: '2',
//       data: { 
//         label: 'Validation Step',
//         hasError: true,
//         errorMessage: 'Missing required field'
//       },
//       position: { x: 0, y: 100 }
//     },
//     {
//       id: '3',
//       data: { 
//         label: 'Complete',
//         hasError: false 
//       },
//       position: { x: 0, y: 200 }
//     }
//   ];

//   const sampleEdges = [
//     { id: 'e1-2', source: '1', target: '2' },
//     { id: 'e2-3', source: '2', target: '3' }
//   ];

//   return <FlowchartDiagram nodes={sampleNodes} edges={sampleEdges} />;
// };

export default FlowchartDiagram;
