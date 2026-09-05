import type { CodeEvaluationResponse, FlowchartData } from './llmSchemas';
import type { FlowchartGenerationContext, FlowchartProgress } from './flowchartGeneration';

export type TaskState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };

export type EvaluationState = TaskState<CodeEvaluationResponse>;
export type FlowchartState =
  | { status: 'idle' }
  | (Exclude<TaskState<FlowchartData>, { status: 'idle' }> & {
    generation?: FlowchartGenerationContext;
    progress?: FlowchartProgress;
  });

interface AnalysisRunOptions {
  requestFeedback: (signal: AbortSignal) => Promise<CodeEvaluationResponse>;
  requestFlowchart: (
    onGenerationReady: (context: FlowchartGenerationContext) => void,
    onProgress: (progress: FlowchartProgress) => void,
    signal: AbortSignal,
  ) => Promise<FlowchartData>;
  onFeedbackChange: (state: EvaluationState) => void;
  onFlowchartChange: (state: FlowchartState) => void;
  /**
   * Optional third stage. It needs a failing input from the evaluation and node
   * ids from the flowchart, so it can only start once both have succeeded, and
   * it is skipped entirely when either did not. It publishes its own states.
   */
  requestTrace?: (
    evaluation: CodeEvaluationResponse,
    flowchart: FlowchartData,
    signal: AbortSignal,
  ) => Promise<void>;
}

export interface AnalysisRun {
  isRunning: () => boolean;
  /** Abort all requests in the run and ignore any late responses. */
  cancel: () => void;
}

/** Publish each outcome immediately, without waiting for the other request. */
export const startAnalysisRun = ({
  requestFeedback,
  requestFlowchart,
  onFeedbackChange,
  onFlowchartChange,
  requestTrace,
}: AnalysisRunOptions): AnalysisRun => {
  let active = true;
  let pending = 2;
  let flowchartGeneration: FlowchartGenerationContext | undefined;
  let flowchartSettled = false;
  let flowchartProgress: FlowchartProgress | undefined;
  const controller = new AbortController();
  const metadata = () => ({
    ...(flowchartGeneration ? { generation: flowchartGeneration } : {}),
    ...(flowchartProgress ? { progress: flowchartProgress } : {}),
  });

  const runTask = async <T>(
    request: () => Promise<T>,
    publish: (state: TaskState<T>) => void,
    fallbackError: string,
  ): Promise<T | undefined> => {
    try {
      const data = await request();
      if (active) publish({ status: 'success', data });
      return data;
    } catch (error: unknown) {
      if (active) {
        publish({
          status: 'error',
          error: error instanceof Error ? error.message : fallbackError,
        });
      }
      return undefined;
    } finally {
      // The trace is a continuation, not a third pending task: the student must
      // be free to edit and re-run while it is still being generated.
      pending--;
    }
  };

  // Clear both previous results and show both loaders before dispatching.
  onFeedbackChange({ status: 'loading' });
  onFlowchartChange({ status: 'loading' });
  const feedback = runTask(
    () => requestFeedback(controller.signal),
    onFeedbackChange,
    'Failed to evaluate your code',
  );
  const charts = runTask(
    () => requestFlowchart(
      (context) => {
        if (!active || flowchartSettled) return;
        flowchartGeneration = context;
        onFlowchartChange({ status: 'loading', ...metadata() });
      },
      (progress) => {
        if (!active || flowchartSettled) return;
        flowchartProgress = progress;
        onFlowchartChange({ status: 'loading', ...metadata() });
      },
      controller.signal,
    ),
    (state) => {
      flowchartSettled = true;
      onFlowchartChange({
        ...state,
        ...metadata(),
      });
    },
    'Failed to build the flowchart',
  );

  if (requestTrace) {
    void Promise.all([feedback, charts]).then(([evaluation, flowchart]) => {
      if (!active || !evaluation || !flowchart) return undefined;
      return requestTrace(evaluation, flowchart, controller.signal);
    });
  }

  return {
    isRunning: () => active && pending > 0,
    cancel: () => { active = false; controller.abort(); },
  };
};
