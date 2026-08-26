import FlowchartDiagram from './FlowchartDiagram';
import type { Node, Edge } from '@xyflow/react';

// Flowchart data interfaces
interface FlowchartNodeData {
  label: string;
  hasError?: boolean;
  errorMessage?: string;
  [key: string]: any;
}

interface FlowchartNode {
  id: string;
  type?: string;
  data: {
    label: string;
    hasError?: boolean;
    errorMessage?: string;
  };
}

interface FlowchartEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface FlowchartData {
  student: {
    nodes: FlowchartNode[];
    edges: FlowchartEdge[];
  };
  llm: {
    nodes: FlowchartNode[];
    edges: FlowchartEdge[];
  };
}

interface RightContentProps {
  flowchartData?: FlowchartData | null;
}

// Convert API node format to React Flow node format
const convertToReactFlowNodes = (nodes: FlowchartNode[]): Node<FlowchartNodeData>[] => {
  return nodes.map(node => ({
    id: node.id,
    type: node.type,
    data: { 
      label: node.data.label,
      hasError: node.data.hasError,
      errorMessage: node.data.errorMessage
    },
    position: { x: 0, y: 0 } // Position will be set by layout algorithm
  }));
};

// Convert API edge format to React Flow edge format
const convertToReactFlowEdges = (edges: FlowchartEdge[]): Edge[] => {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    data: {
      label: edge.label
    }
  }));
};

function RightContent({ flowchartData }: RightContentProps) {
  return (
    <div className="w-full p-4">
      <h2 className="text-xl font-bold mb-4">Code Analysis</h2>
      
      {flowchartData ? (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-2">Student's Logic Flow</h3>
              <div className="border rounded-lg overflow-hidden h-full">
                <FlowchartDiagram 
                  nodes={convertToReactFlowNodes(flowchartData.student.nodes)} 
                  edges={convertToReactFlowEdges(flowchartData.student.edges)} 
                />
              </div>
            </div>
            
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-2">Recommended Logic Flow</h3>
              <div className="border rounded-lg overflow-hidden h-full">
                <FlowchartDiagram 
                  nodes={convertToReactFlowNodes(flowchartData.llm.nodes)} 
                  edges={convertToReactFlowEdges(flowchartData.llm.edges)} 
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-gray-600">
            Please submit your code first in order to see the feedback.
          </p>
        </div>
      )}
    </div>
  );
}

export default RightContent;
