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
interface FlowchartNodeData {
  label: string;
  hasError?: boolean;
  errorMessage?: string;
  [key: string]: any;
}

// Constants for node sizing
const nodeWidth = 180;
const nodeHeight = 40;

interface FlowchartDiagramProps {
  nodes: Node<FlowchartNodeData>[];
  edges: Edge[];
}

// Custom Node Component following the pattern you provided
const CustomNode = memo(({ data }: { data: FlowchartNodeData }) => {
  const { label, hasError, errorMessage } = data;
  
  return (
    <div className={`px-4 py-2 shadow-md rounded-md border-2 ${
      hasError 
        ? 'bg-red-50 border-red-400' 
        : 'bg-white border-stone-400'
    }`}>
      <div className="flex flex-col">
        <div className={`text-sm font-medium ${
          hasError ? 'text-red-800' : 'text-gray-900'
        }`}>
          {label}
        </div>
        {hasError && errorMessage && (
          <div className="text-xs text-red-600 mt-1 bg-red-100 px-2 py-1 rounded border border-red-200">
            {errorMessage}
          </div>
        )}
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
        targetPosition: 'top' as any,
        sourcePosition: 'bottom' as any,
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