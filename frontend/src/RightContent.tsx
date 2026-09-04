import FlowchartDiagram from './FlowchartDiagram';
import FlowchartDiagnostics from './FlowchartDiagnostics';
import TracePanel from './TracePanel';
import { useEffect, useMemo, useState } from 'react';
import type { FlowchartState } from './lib/analysisRun';
import { traceDivergenceIndex, type TraceSide } from './lib/executionTrace';
import type { TraceHighlight } from './lib/traceHighlight';
import type { TraceRequest, TraceState } from './lib/traceRun';
import type { FlowchartNode, FlowchartEdge, FlowchartSide } from './lib/llmSchemas';
import type { DiagramNode, DiagramEdge } from './lib/flowchartLayout';

interface RightContentProps {
  flowchartState: FlowchartState;
  traceState: TraceState;
  onRetrace: (request: TraceRequest) => void;
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

function FlowchartPane({ title, graph, loading, trace, step = 0 }: {
  title: string;
  graph?: FlowchartSide;
  loading: boolean;
  /** Omitted by the static pair above, which is never marked up by a trace. */
  trace?: TraceSide;
  step?: number;
}) {
  // Memoize each side separately: the next side or diagnostic must not move
  // nodes that the student is already reading/dragging.
  const diagram = useMemo(() => graph ? {
    nodes: convertToReactFlowNodes(graph.nodes),
    edges: convertToReactFlowEdges(graph.edges),
  } : undefined, [graph]);

  // A shorter run stays parked on its last step while the other side walks on,
  // so the student can see which side stopped first and where.
  const reached = trace?.steps.length ? Math.min(step, trace.steps.length - 1) : -1;
  const finished = trace ? step >= trace.steps.length - 1 : false;
  const current = reached >= 0 ? trace!.steps[reached] : undefined;

  const highlight = useMemo((): TraceHighlight | undefined => {
    if (!trace || reached < 0) return undefined;
    return {
      activeNodeId: trace.steps[reached].nodeId,
      visitedNodeIds: new Set(trace.steps.slice(0, reached + 1).map((entry) => entry.nodeId)),
    };
  }, [trace, reached]);

  return (
    <section className="min-w-0 flex-1" aria-label={title} aria-busy={!graph && loading}>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      {diagram ? (
        <div className="border rounded-lg overflow-hidden">
          <FlowchartDiagram nodes={diagram.nodes} edges={diagram.edges} highlight={highlight} />
        </div>
      ) : loading ? (
        <div role="status" className="flex min-h-[160px] items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 p-6 text-blue-700">
          <span aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          Generating flowchart...
        </div>
      ) : <p className="rounded-lg border p-4 text-sm text-gray-600">Flowchart unavailable</p>}

      {current && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <p className="text-gray-800">{current.note || 'No description for this step.'}</p>
          {current.variables.length > 0 && (
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-gray-700">
              {current.variables.map((variable) => (
                <div key={variable.name} className="flex gap-1">
                  <dt className="font-semibold">{variable.name}</dt>
                  <dd>= {variable.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {finished && trace && (
            <p className="mt-2 border-t border-gray-100 pt-2 text-gray-700">
              {trace.truncated
                ? 'This run was cut off before it reached an exit.'
                : <><span className="font-semibold">Result:</span> <span className="font-mono">{trace.finalOutput || 'none reported'}</span></>}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function RightContent({ flowchartState, traceState, onRetrace }: RightContentProps) {
  const generation = flowchartState.status === 'idle' ? undefined : flowchartState.generation;
  const graphs = flowchartState.status === 'success' ? flowchartState.data
    : flowchartState.status === 'idle' ? undefined : flowchartState.progress;

  const traceRequest = traceState.status === 'idle' || traceState.status === 'skipped'
    ? undefined
    : traceState.request;
  const traces = traceState.status === 'success' ? traceState.data
    : traceState.status === 'loading' ? traceState.progress
    : undefined;

  const [step, setStep] = useState(0);
  // Every new trace — a new run or a re-trace of a new input — starts at step 1.
  useEffect(() => { setStep(0); }, [traceRequest]);

  const totalSteps = Math.max(traces?.student?.steps.length ?? 0, traces?.llm?.steps.length ?? 0);
  const safeStep = Math.min(step, Math.max(0, totalSteps - 1));

  const divergence = useMemo(() => {
    if (!traces?.student || !traces.llm || !graphs?.student || !graphs.llm) return null;
    return traceDivergenceIndex(
      { student: traces.student, llm: traces.llm },
      { student: graphs.student, llm: graphs.llm },
    );
  }, [traces, graphs]);

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
        // The structural comparison. These two are never marked up by a trace:
        // the student reads and rearranges them, and a replay must not disturb
        // whatever they have arranged here.
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

      {traceState.status !== 'idle' && (
        // A second area, not a second generation: the same two graphs above are
        // rendered again here, on their own React Flow instances, so that
        // stepping through a run cannot move or recolour the charts above.
        <section aria-label="Execution trace" className="mt-10 border-t-2 border-gray-300 pt-6">
          <TracePanel
            traceState={traceState}
            sides={{ student: traces?.student, llm: traces?.llm }}
            totalSteps={totalSteps}
            step={safeStep}
            onStepChange={setStep}
            divergence={divergence}
            onRetrace={onRetrace}
          />
          {totalSteps > 0 && graphs?.student && graphs.llm ? (
            <div className="flex flex-col md:flex-row gap-6">
              <FlowchartPane title="Student's Run" graph={graphs.student} loading={false} trace={traces?.student} step={safeStep} />
              <FlowchartPane title="Recommended Run" graph={graphs.llm} loading={false} trace={traces?.llm} step={safeStep} />
            </div>
          ) : traceState.status === 'loading' ? (
            <div role="status" className="flex min-h-[160px] items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 p-6 text-blue-700">
              <span aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
              The AI is working through this input step by step...
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

export default RightContent;
