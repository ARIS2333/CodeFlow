import { requestExecutionTrace, type TraceCase, type TraceProgress, type TraceRequest } from './traceClient.ts';
import type { ExecutionTrace } from './executionTrace';
import type { TestResult } from './llmSchemas';

export type { TraceCase, TraceProgress, TraceRequest };

export type TraceState =
  | { status: 'idle' }
  /** No test case can be traced, e.g. nothing compiled. Explained to the student. */
  | { status: 'skipped'; reason: string }
  | { status: 'loading'; request: TraceRequest; progress?: TraceProgress }
  | { status: 'success'; request: TraceRequest; data: ExecutionTrace; warning?: string }
  | { status: 'error'; request: TraceRequest; error: string };

/** The evaluation prompt decorates outputs with these; they are not the value. */
const VERDICT_MARKS = /[✅❌\u{1F527}]/gu;

const isCompileError = (result: TestResult): boolean =>
  /compile\s*error/i.test(result.yourOutput);

const isPassing = (result: TestResult): boolean => result.yourOutput.includes('✅');

/**
 * Pick the case worth walking through.
 *
 * A failing case is where the two traces have something to show, so it wins. A
 * compile error is not runnable at all and is never traced — which also means
 * code too broken to parse quietly gets no trace, without a separate check.
 * Among equals the shortest input goes first: it is a rough but cheap proxy for
 * the fewest loop iterations, and a short trace is the one a student reads.
 */
export const selectTraceCase = (results: TestResult[]): TraceCase | null => {
  const runnable = results.filter((result) => result.input.trim() && !isCompileError(result));
  if (!runnable.length) return null;

  const failing = runnable.filter((result) => !isPassing(result));
  const pool = failing.length ? failing : runnable;
  const chosen = [...pool].sort((left, right) => left.input.length - right.input.length)[0];

  return {
    input: chosen.input,
    ...(chosen.expected.trim() ? { expected: chosen.expected.trim() } : {}),
    ...(chosen.yourOutput.trim() ? { observedOutput: chosen.yourOutput } : {}),
  };
};

export const noTraceableCaseReason =
  'No test case could be traced. The code did not run for any of the inputs above.';

const sameValue = (left: string, right: string): boolean =>
  left.replace(VERDICT_MARKS, '').trim().toLowerCase() ===
  right.replace(VERDICT_MARKS, '').trim().toLowerCase();

/**
 * The one cross-check we can make locally: two separate model replies described
 * the same run, so they should agree on where it ended. A mismatch does not say
 * which one is wrong, only that the student should not trust either blindly.
 */
const checkAgainstEvaluation = (
  trace: ExecutionTrace,
  testCase: TraceCase
): string | undefined => {
  if (trace.student.truncated || !testCase.observedOutput) return undefined;
  if (sameValue(trace.student.finalOutput, testCase.observedOutput)) return undefined;
  return (
    `This trace ends with ${trace.student.finalOutput || 'no result'}, but running the ` +
    `code reported ${testCase.observedOutput.replace(VERDICT_MARKS, '').trim()}. ` +
    'The two disagree, so read the steps as a suggestion rather than a fact.'
  );
};

/**
 * Run one trace and publish every state it passes through. Used both for the
 * automatic trace after a run and for a re-trace with a student-chosen input,
 * so both paths report progress, warnings, and failures the same way.
 */
export const runTrace = async (
  request: TraceRequest,
  onChange: (state: TraceState) => void,
  signal?: AbortSignal
): Promise<void> => {
  // A cancelled run must not overwrite whatever replaced it on screen.
  const publish = (state: TraceState) => {
    if (!signal?.aborted) onChange(state);
  };

  publish({ status: 'loading', request });
  try {
    const data = await requestExecutionTrace(request, {
      signal,
      onProgress: (progress) => publish({ status: 'loading', request, progress }),
    });
    const warning = checkAgainstEvaluation(data, request.testCase);
    publish({ status: 'success', request, data, ...(warning ? { warning } : {}) });
  } catch (error: unknown) {
    if (signal?.aborted) return;
    publish({
      status: 'error',
      request,
      error: error instanceof Error ? error.message : 'Failed to trace this input',
    });
  }
};
