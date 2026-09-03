import type { CodeEvaluationResponse, FlowchartData } from './llmSchemas';
import type { FlowchartGenerationContext } from './flowchartGeneration';

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
  });

interface AnalysisRunOptions {
  requestFeedback: () => Promise<CodeEvaluationResponse>;
  requestFlowchart: (
    onGenerationReady: (context: FlowchartGenerationContext) => void
  ) => Promise<FlowchartData>;
  onFeedbackChange: (state: EvaluationState) => void;
  onFlowchartChange: (state: FlowchartState) => void;
}

export interface AnalysisRun {
  isRunning: () => boolean;
  /** Ignore later responses; this does not cancel requests already in flight. */
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
    () => requestFlowchart((context) => {
      if (!active || flowchartSettled) return;
      flowchartGeneration = context;
      onFlowchartChange({ status: 'loading', generation: context });
    }),
    (state) => {
      flowchartSettled = true;
      onFlowchartChange({
        ...state,
        ...(flowchartGeneration ? { generation: flowchartGeneration } : {}),
      });
    },
    'Failed to build the flowchart',
  );

  return {
    isRunning: () => active && pending > 0,
    cancel: () => { active = false; },
  };
};
