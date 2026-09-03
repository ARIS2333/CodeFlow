import { useCallback, useEffect, useRef, memo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
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
import type { SyntaxErrorMark } from './lib/llmSchemas';
import '@xyflow/react/dist/style.css';

// Define types for our flowchart data
// A token-level syntax mistake, located by plain text search inside the label.
// `occurrence` is 1-based and picks which match to mark when the symbol repeats.
interface LabelSegment {
  text: string;
  marked: boolean;
  expected?: string;
}

// Split a label into plain and syntax-marked segments. Syntax errors are shown
// by colouring the offending symbol in place rather than by adding text, so the
// node stays compact and the written explanations are reserved for logic errors.
// A symbol that isn't found in the label is skipped: the rest of the label still
// renders correctly and the node simply carries no mark.
const markSyntaxErrors = (
  label: string,
  syntaxErrors?: SyntaxErrorMark[]
): LabelSegment[] => {
  if (!syntaxErrors?.length) return [{ text: label, marked: false }];

  const ranges: { start: number; end: number; expected?: string }[] = [];

  syntaxErrors.forEach(({ symbol, occurrence = 1, expected }) => {
    if (!symbol) return;

    // Walk forward to the nth occurrence; give up if the label has fewer.
    let start = -1;
    let from = 0;
    for (let i = 0; i < occurrence; i++) {
      start = label.indexOf(symbol, from);
      if (start === -1) return;
      from = start + symbol.length;
    }

    const end = start + symbol.length;
    const overlaps = ranges.some((r) => start < r.end && end > r.start);
    if (!overlaps) ranges.push({ start, end, expected });
  });

  if (!ranges.length) return [{ text: label, marked: false }];

  ranges.sort((a, b) => a.start - b.start);

  const segments: LabelSegment[] = [];
  let cursor = 0;

  ranges.forEach(({ start, end, expected }) => {
    if (start > cursor) {
      segments.push({ text: label.slice(cursor, start), marked: false });
    }
    segments.push({ text: label.slice(start, end), marked: true, expected });
    cursor = end;
  });

  if (cursor < label.length) {
    segments.push({ text: label.slice(cursor), marked: false });
  }

  return segments;
};

interface FlowchartDiagramProps {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

// Custom Node Component following the pattern you provided
// Every node looks the same. A logic mistake is never marked here: the student
// finds it by comparing their flow against the recommended one, and marking it
// would take that discovery away. Only token-level syntax slips get a mark, and
// only on the offending character.
const CustomNode = memo(({ data }: { data: FlowchartNodeData }) => {
  const { label, syntaxErrors } = data;
  const segments = markSyntaxErrors(label, syntaxErrors);

  return (
    <div className="px-4 py-2 shadow-md rounded-md border-2 bg-white border-stone-400">
      <div className="flex flex-col">
        <div className="text-sm font-medium whitespace-pre-wrap text-gray-900">
          {segments.map((segment, index) =>
            segment.marked ? (
              <span
                key={index}
                title={
                  segment.expected
                    ? `Expected ${segment.expected} after this token`
                    : 'Syntax error'
                }
                className="rounded-sm bg-amber-100 px-px font-semibold text-amber-900 underline decoration-amber-500 decoration-wavy decoration-2 underline-offset-2"
              >
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            )
          )}
        </div>
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
const FlowchartDiagramInner = ({ nodes, edges }: FlowchartDiagramProps) => {
  const { fitView, getNodes, getInternalNode } = useReactFlow<DiagramNode, DiagramEdge>();
  const [flowNodes, setNodes, onNodesChange] = useNodesState<DiagramNode>([]);
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState<DiagramEdge>([]);
  const nodesInitialized = useNodesInitialized();
  const [phase, setPhase] = useState<'measuring' | 'layout' | 'ready'>('measuring');
  const [hasLayout, setHasLayout] = useState(false);
  const [layoutWarning, setLayoutWarning] = useState<string | null>(null);
  const requestVersion = useRef({ value: 0 });
  const fitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setLayoutWarning('Using basic layout. Re-Layout to retry automatic routing.');
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

  return (
    <div className="relative h-full">
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
      proOptions={{ hideAttribution: true }}
      className="bg-teal-50"
    >
      <Panel position="top-right">
        <button 
          onClick={() => { void onLayout(); }}
          disabled={phase !== 'ready'}
          className="px-3 py-1 bg-gray-800 text-white rounded text-sm hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {phase === 'ready' ? 'Re-Layout' : 'Arranging...'}
        </button>
      </Panel>
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

// Main component that provides the React Flow context
const FlowchartDiagram = ({ nodes, edges }: FlowchartDiagramProps) => {
  return (
    <div className="w-full h-[500px]">
      <ReactFlowProvider>
        <FlowchartDiagramInner nodes={nodes} edges={edges} />
      </ReactFlowProvider>
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
