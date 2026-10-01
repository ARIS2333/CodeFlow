import FlowchartDiagram from './FlowchartDiagram';
import FlowchartDiagnostics from './FlowchartDiagnostics';
import TracePanel, { TraceControls } from './TracePanel';
import { useEffect, useMemo, useState } from 'react';
import type { EvaluationState, FlowchartRegenerationState, FlowchartState } from './lib/analysisRun';
import type { TraceSide } from './lib/executionTrace';
import type { TraceHighlight } from './lib/traceHighlight';
import type { TraceRequest, TraceState } from './lib/traceRun';
import type { FlowchartNode, FlowchartEdge, FlowchartSide } from './lib/llmSchemas';
import type { DiagramNode, DiagramEdge } from './lib/flowchartLayout';
import { traceVariableChanges } from './lib/tracePresentation';

interface RightContentProps {
  flowchartState: FlowchartState;
  evaluationState?: EvaluationState;
  traceState: TraceState;
  onRetrace: (request: TraceRequest) => void;
  onRegenerateFlowchart?: () => void;
  canRegenerateFlowchart?: boolean;
  flowchartRegenerationState?: FlowchartRegenerationState;
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

    </section>
  );
}

function TraceStepDetails({ trace, step = 0 }: { trace?: TraceSide; step?: number }) {
  const reached = trace?.steps.length ? Math.min(step, trace.steps.length - 1) : -1;
  const current = reached >= 0 ? trace!.steps[reached] : undefined;
  const changes = trace && reached >= 0 ? traceVariableChanges(trace, reached) : [];

  return (
    <section className="min-w-0 flex-1">
      {current && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-gray-900">
              Step {reached + 1} of {trace?.steps.length}
            </p>
            {current.branch && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                Path: {current.branch}
              </span>
            )}
          </div>

          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {reached === 0 ? 'Initial state' : 'State changes'}
            </p>
            {changes.length > 0 ? (
              <dl className="mt-1 flex flex-wrap gap-2 font-mono text-xs">
                {changes.map((change) => (
                  <div key={change.name} className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-emerald-900">
                    <dt className="font-semibold">{change.name}</dt>
                    <dd>
                      {change.previous !== undefined
                        ? `${change.previous} → ${change.value}`
                        : `= ${change.value}`}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                {reached === 0 ? 'No variables reported.' : 'No variables changed.'}
              </p>
            )}

            {current.variables.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-gray-700">
                <p className="font-semibold text-gray-700">All variables</p>
                <dl className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2 font-mono">
                  {current.variables.map((variable) => (
                    <div key={variable.name} className="min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-2 shadow-sm">
                      <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {variable.name}
                      </dt>
                      <dd className="mt-0.5 break-words text-sm font-semibold text-slate-900">
                        {variable.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function RightContent({
  flowchartState,
  evaluationState,
  traceState,
  onRetrace,
  onRegenerateFlowchart = () => {},
  canRegenerateFlowchart = false,
  flowchartRegenerationState = { status: 'idle' },
}: RightContentProps) {
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
  const flowchartError = flowchartState.status === 'error' ? flowchartState.error : undefined;
  const regenerationError = flowchartRegenerationState.status === 'error'
    ? flowchartRegenerationState.error
    : undefined;
  useEffect(() => {
    if (flowchartError) console.error('[flowchart] generation failed:', flowchartError);
  }, [flowchartError]);
  useEffect(() => {
    if (regenerationError) console.error('[flowchart] regeneration failed:', regenerationError);
  }, [regenerationError]);

  const totalSteps = Math.max(traces?.student?.steps.length ?? 0, traces?.llm?.steps.length ?? 0);
  const safeStep = Math.min(step, Math.max(0, totalSteps - 1));
  return (
    <div className="w-full p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Code Analysis</h2>
        {flowchartState.status !== 'idle' && (
          <button
            type="button"
            onClick={onRegenerateFlowchart}
            disabled={!canRegenerateFlowchart || flowchartRegenerationState.status === 'loading'}
            className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {flowchartRegenerationState.status === 'loading'
              ? 'Regenerating Flowcharts...'
              : 'Regenerate Flowcharts'}
          </button>
        )}
      </div>
      {flowchartRegenerationState.status === 'error' && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Could not regenerate the flowcharts</p>
          <p className="mt-1">
            Possible causes include a syntax or compile error in the code, or a temporary AI generation issue.
          </p>
          <p className="mt-1">The previous flowcharts and trace are still available.</p>
        </div>
      )}
      <FlowchartDiagnostics generation={generation} evaluationState={evaluationState} />

      {flowchartState.status === 'error' && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="font-semibold">Flowchart generation failed</p>
          <p className="mt-1 text-sm">
            The AI could not generate a valid flowchart. Possible causes include a syntax or compile error in the code, or a temporary generation issue.
          </p>
          <p className="mt-1 text-sm">Check the code, then try Regenerate Flowcharts.</p>
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
            onRetrace={onRetrace}
          />
          {totalSteps > 0 && graphs?.student && graphs.llm ? (
            <>
              <div className="flex flex-col gap-6 md:flex-row">
                <FlowchartPane
                  title="Student's Run"
                  graph={graphs.student}
                  loading={false}
                  trace={traces?.student}
                  step={safeStep}
                />
                <FlowchartPane title="Recommended Run" graph={graphs.llm} loading={false} trace={traces?.llm} step={safeStep} />
              </div>
              <TraceControls totalSteps={totalSteps} step={safeStep} onStepChange={setStep} />
              <div className="flex flex-col gap-6 md:flex-row">
                <TraceStepDetails trace={traces?.student} step={safeStep} />
                <TraceStepDetails trace={traces?.llm} step={safeStep} />
              </div>
            </>
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
