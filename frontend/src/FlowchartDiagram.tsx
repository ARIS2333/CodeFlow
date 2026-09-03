import { useCallback, useEffect, memo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  type Node,
  type Edge
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';

// Define types for our flowchart data
// A token-level syntax mistake, located by plain text search inside the label.
// `occurrence` is 1-based and picks which match to mark when the symbol repeats.
interface SyntaxErrorMark {
  symbol: string;
  occurrence?: number;
  expected?: string;
}

interface FlowchartNodeData {
  label: string;
  syntaxErrors?: SyntaxErrorMark[];
  [key: string]: unknown;
}

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

// Constants for node sizing
const nodeWidth = 180;
const nodeHeight = 40;

interface FlowchartDiagramProps {
  nodes: Node<FlowchartNodeData>[];
  edges: Edge[];
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
        type="target"
        position={Position.Top}
        className="w-16 !bg-teal-500"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-16 !bg-teal-500"
      />
    </div>
  );
});

// Define custom node types
const nodeTypes = {
  custom: CustomNode,
};

// Function to calculate layout using dagre
const getLayoutedElements = (nodes: Node<FlowchartNodeData>[], edges: Edge[]) => {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB' });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const { x, y } = g.node(node.id);
      return {
        ...node,
        type: 'custom', // Ensure all nodes use our custom type
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom,
        position: {
          x: x - nodeWidth / 2,
          y: y - nodeHeight / 2,
        }
      };
    }),
    edges
  };
};

// Inner component that uses React Flow hooks
const FlowchartDiagramInner = ({ nodes, edges }: FlowchartDiagramProps) => {
  const { fitView } = useReactFlow();
  const [flowNodes, setNodes, onNodesChange] = useNodesState<Node<FlowchartNodeData>>([]);
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Auto layout on component mount or when nodes/edges change
  useEffect(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges);
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    
    // Fit view after a short delay to ensure layout is complete
    setTimeout(() => fitView(), 100);
  }, [nodes, edges, fitView, setNodes, setEdges]);

  const onLayout = useCallback(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(flowNodes, flowEdges);
    setNodes([...layoutedNodes]);
    setEdges([...layoutedEdges]);
    setTimeout(() => fitView(), 0);
  }, [flowNodes, flowEdges, fitView, setNodes, setEdges]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
      className="bg-teal-50"
    >
      <Panel position="top-right">
        <button 
          onClick={onLayout} 
          className="px-3 py-1 bg-gray-800 text-white rounded text-sm hover:bg-gray-700 transition-colors"
        >
          Re-Layout
        </button>
      </Panel>
    </ReactFlow>
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
