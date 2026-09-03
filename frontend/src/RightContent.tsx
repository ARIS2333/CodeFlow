import FlowchartDiagram from './FlowchartDiagram';
import type { Node, Edge } from '@xyflow/react';
import type { FlowchartState } from './lib/analysisRun';
import type { FlowchartNode, FlowchartEdge, SyntaxErrorMark } from './lib/llmSchemas';

interface FlowchartNodeData {
  label: string;
  syntaxErrors?: SyntaxErrorMark[];
  [key: string]: unknown;
}

interface RightContentProps {
  flowchartState: FlowchartState;
}

// Convert API node format to React Flow node format
const convertToReactFlowNodes = (nodes: FlowchartNode[]): Node<FlowchartNodeData>[] => {
  return nodes.map(node => ({
    id: node.id,
    data: { 
      label: node.data.label,
      syntaxErrors: node.data.syntaxErrors
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

function RightContent({ flowchartState }: RightContentProps) {
  const flowchartData = flowchartState.status === 'success' ? flowchartState.data : null;

  return (
    <div className="w-full p-4" aria-busy={flowchartState.status === 'loading'}>
      <h2 className="text-xl font-bold mb-4">Code Analysis</h2>
      
      {flowchartState.status === 'loading' ? (
        <div role="status" className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 p-6 text-blue-700 min-h-[160px]">
          <div aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          <div>
            <p className="font-medium">Generating flowcharts...</p>
            <p className="mt-1 text-sm">Analyzing your code and building both logic flows.</p>
          </div>
        </div>
      ) : flowchartState.status === 'error' ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="font-semibold">Flowchart unavailable</p>
          <p className="mt-1 text-sm">{flowchartState.error}</p>
        </div>
      ) : flowchartData ? (
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
