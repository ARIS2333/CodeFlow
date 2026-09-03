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
  requestFeedback: () => Promise<CodeEvaluationResponse>;
  requestFlowchart: (
    onGenerationReady: (context: FlowchartGenerationContext) => void,
    onProgress: (progress: FlowchartProgress) => void,
    signal: AbortSignal,
  ) => Promise<FlowchartData>;
  onFeedbackChange: (state: EvaluationState) => void;
  onFlowchartChange: (state: FlowchartState) => void;
}

export interface AnalysisRun {
  isRunning: () => boolean;
  /** Abort flowchart preprocessing/streaming; ignore late evaluation responses. */
  cancel: () => void;
}

/** Publish each outcome immediately, without waiting for the other request. */
export const startAnalysisRun = ({
  requestFeedback,
  requestFlowchart,
  onFeedbackChange,
  onFlowchartChange,
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
  ) => {
    try {
      const data = await request();
      if (active) publish({ status: 'success', data });
    } catch (error: unknown) {
      if (active) {
        publish({
          status: 'error',
          error: error instanceof Error ? error.message : fallbackError,
        });
      }
    } finally {
      pending--;
    }
  };

  // Clear both previous results and show both loaders before dispatching.
  onFeedbackChange({ status: 'loading' });
  onFlowchartChange({ status: 'loading' });
  void runTask(requestFeedback, onFeedbackChange, 'Failed to evaluate your code');
  void runTask(
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

  return {
    isRunning: () => active && pending > 0,
    cancel: () => { active = false; controller.abort(); },
  };
};
