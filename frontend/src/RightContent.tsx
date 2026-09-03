import FlowchartDiagram from './FlowchartDiagram';
import FlowchartDiagnostics from './FlowchartDiagnostics';
import { useMemo } from 'react';
import type { FlowchartState } from './lib/analysisRun';
import type { FlowchartNode, FlowchartEdge, FlowchartSide } from './lib/llmSchemas';
import type { DiagramNode, DiagramEdge } from './lib/flowchartLayout';

interface RightContentProps {
  flowchartState: FlowchartState;
}

// Convert API node format to React Flow node format
const convertToReactFlowNodes = (nodes: FlowchartNode[]): DiagramNode[] => {
  return nodes.map(node => ({
    id: node.id,
    data: { 
      kind: node.kind,
      label: node.data.label,
      syntaxErrors: node.data.syntaxErrors
    },
    position: { x: 0, y: 0 } // Position will be set by layout algorithm
  }));
};

// Convert API edge format to React Flow edge format
const convertToReactFlowEdges = (edges: FlowchartEdge[]): DiagramEdge[] => {
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

function FlowchartPane({ title, graph, loading }: {
  title: string;
  graph?: FlowchartSide;
  loading: boolean;
}) {
  // Memoize each side separately: the next side or diagnostic must not move
  // nodes that the student is already reading/dragging.
  const diagram = useMemo(() => graph ? {
    nodes: convertToReactFlowNodes(graph.nodes),
    edges: convertToReactFlowEdges(graph.edges),
  } : undefined, [graph]);

  return (
    <section className="min-w-0 flex-1" aria-label={title} aria-busy={!graph && loading}>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      {diagram ? (
        <div className="border rounded-lg overflow-hidden">
          <FlowchartDiagram nodes={diagram.nodes} edges={diagram.edges} />
        </div>
      ) : loading ? (
        <div role="status" className="flex min-h-[160px] items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 p-6 text-blue-700">
          <span aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          Generating flowchart...
        </div>
      ) : <p className="rounded-lg border p-4 text-sm text-gray-600">Flowchart unavailable</p>}
    </section>
  );
}

function RightContent({ flowchartState }: RightContentProps) {
  const generation = flowchartState.status === 'idle' ? undefined : flowchartState.generation;
  const graphs = flowchartState.status === 'success' ? flowchartState.data
    : flowchartState.status === 'idle' ? undefined : flowchartState.progress;

  return (
    <div className="w-full p-4">
      <h2 className="text-xl font-bold mb-4">Code Analysis</h2>
      <FlowchartDiagnostics generation={generation} />
      
      {flowchartState.status === 'error' && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="font-semibold">{graphs?.student || graphs?.llm ? 'Generation incomplete' : 'Flowchart unavailable'}</p>
          <p className="mt-1 text-sm">{flowchartState.error}</p>
        </div>
      )}
      {flowchartState.status !== 'idle' ? (
        <div className="flex flex-col md:flex-row gap-6">
          <FlowchartPane title="Student's Logic Flow" graph={graphs?.student} loading={flowchartState.status === 'loading'} />
          <FlowchartPane title="Recommended Logic Flow" graph={graphs?.llm} loading={flowchartState.status === 'loading'} />
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
