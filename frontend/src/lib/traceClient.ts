import { systemPrompt_TraceExecution } from '../config/systemPrompt_TraceExecution.ts';
import { CPP_TRACE_URL } from '../config/apiConfig.ts';
import { makeApiRequestWithRetry } from './llmClient.ts';
import { requestJsonStream } from './llmStreamClient.ts';
import type { ModelConfigPayload } from './modelSettings.ts';
import {
  createTraceValidator,
  validateTraceSideOnly,
  type ExecutionTrace,
  type TraceSide,
} from './executionTrace.ts';
import type { SupportedLanguage } from './codeAnalysis';
import type { FlowchartData, FlowchartSide, ProblemDetails } from './llmSchemas';

/** The test case being traced. Only input and expected are sent to the model. */
export interface TraceCase {
  input: string;
  /** The exercise's correct answer, when a graded test case supplied one. */
  expected?: string;
  /**
   * What the evaluation said the student's code actually produced. Kept local:
   * it is the independent check on the trace, so the model must not see it.
   */
  observedOutput?: string;
}

export interface TraceRequest {
  practice: ProblemDetails;
  language: SupportedLanguage;
  code: string;
  /** The graphs already on screen; the trace's node ids must match them. */
  graphs: FlowchartData;
  testCase: TraceCase;
}

export interface TraceProgress {
  attempt: number;
  student?: TraceSide;
  llm?: TraceSide;
}

/** Send the drawn graph only: anchors and syntax marks are not part of a run. */
const compactSide = (side: FlowchartSide) => ({
  nodes: side.nodes.map((node) => ({ id: node.id, kind: node.kind, label: node.data.label })),
  edges: side.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    ...(edge.label ? { label: edge.label } : {}),
  })),
});

export const requestExecutionTrace = async (
  request: TraceRequest,
  options: {
    onProgress?: (progress: TraceProgress) => void;
    signal?: AbortSignal;
    /** Which model to call; travels beside the prompt, never inside it. */
    modelConfig: ModelConfigPayload;
  }
): Promise<ExecutionTrace> => {
  let progress: TraceProgress = { attempt: 1 };
  const validate = createTraceValidator(request.graphs);

  // The fixed C++ study tasks can be executed with deterministic source
  // instrumentation. Keep the model path below as a bounded fallback for a
  // source construct the first tracer version does not support.
  if (request.language === 'cpp' && request.graphs.recommendedCode?.trim()) {
    try {
      const response = await makeApiRequestWithRetry({
        url: CPP_TRACE_URL,
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentCode: request.code,
            recommendedCode: request.graphs.recommendedCode,
            input: request.testCase.input,
            ...('registrationId' in options.modelConfig
              ? { registrationId: options.modelConfig.registrationId }
              : {}),
          }),
          signal: options.signal,
        },
      }, 0, 0, 15_000);
      const payload = await response.json() as unknown;
      const result = validate(payload);
      if (result.ok) {
        const realTrace: ExecutionTrace = {
          ...result.value,
          source: 'instrumented-cpp',
        };
        options.onProgress?.({
          attempt: 1,
          student: realTrace.student,
          llm: realTrace.llm,
        });
        return realTrace;
      }
    } catch (error: unknown) {
      options.signal?.throwIfAborted();
      // Unsupported instrumentation and transient execution failures fall
      // through to the existing trace generator. The UI remains available,
      // while successful real traces consume no model tokens.
      console.info('Real C++ trace unavailable; using model fallback.', error);
    }
  }

  const simulated = await requestJsonStream({
    modelConfig: options.modelConfig,
    systemPrompt: systemPrompt_TraceExecution,
    message: JSON.stringify({
      practice: request.practice,
      language: request.language,
      code: request.code,
      testCase: {
        input: request.testCase.input,
        ...(request.testCase.expected ? { expected: request.testCase.expected } : {}),
      },
      flowcharts: {
        student: compactSide(request.graphs.student),
        llm: compactSide(request.graphs.llm),
      },
    }),
    validate: (input) => {
      const result = validate(input);
      if (!result.ok) return result;
      // Reuse the already-displayed side objects so finishing the response does
      // not reset the step the student is currently looking at.
      return {
        ...result,
        value: {
          student: progress.student ?? result.value.student,
          llm: progress.llm ?? result.value.llm,
        },
      };
    },
    onAttempt: (attempt) => {
      progress = { attempt };
      options.onProgress?.(progress);
    },
    onValue: (event) => {
      if (event.type !== 'field') return;
      if (event.key !== 'student' && event.key !== 'llm') return;
      const side = validateTraceSideOnly(event.key, event.value, request.graphs[event.key]);
      if (side.ok) {
        progress = { ...progress, [event.key]: side.value };
        options.onProgress?.(progress);
      }
    },
    signal: options.signal,
    label: 'execution trace',
    maxAttempts: 2,
  });
  return { ...simulated, source: 'model-simulated' };
};
