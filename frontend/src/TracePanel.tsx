import { useEffect, useState } from 'react';
import type { TraceSide } from './lib/executionTrace';
import type { TraceRequest, TraceState } from './lib/traceRun';

interface TracePanelProps {
  traceState: TraceState;
  /** Whatever is displayable now: a finished trace, or one side of a streaming one. */
  sides: { student?: TraceSide; llm?: TraceSide };
  totalSteps: number;
  step: number;
  onStepChange: (step: number) => void;
  /** First step where the two runs stop matching, or null while they agree. */
  divergence: number | null;
  onRetrace: (request: TraceRequest) => void;
}

const controlClasses =
  'rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 ' +
  'transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40';

export default function TracePanel({
  traceState,
  sides,
  totalSteps,
  step,
  onStepChange,
  divergence,
  onRetrace,
}: TracePanelProps) {
  const request = traceState.status === 'idle' || traceState.status === 'skipped'
    ? undefined
    : traceState.request;
  // Seeded from the request as well as followed, so reopening the panel during
  // a trace shows the input being traced rather than an empty box.
  const [draft, setDraft] = useState(() => request?.testCase.input ?? '');
  useEffect(() => { setDraft(request?.testCase.input ?? ''); }, [request]);

  if (traceState.status === 'idle') return null;

  if (traceState.status === 'skipped') {
    return (
      <div role="status" className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <p className="font-semibold text-gray-700">Execution trace unavailable</p>
        <p className="mt-1">{traceState.reason}</p>
      </div>
    );
  }

  const loading = traceState.status === 'loading';
  const submit = () => {
    const input = draft.trim();
    if (!request || !input || loading) return;
    // A student-chosen input has no graded expectation, so trace it on its own.
    onRetrace({ ...request, testCase: { input } });
  };

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-800">Execution Trace</h3>
        {loading && (
          <span role="status" className="flex items-center gap-2 text-sm text-blue-700">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
            Tracing this input...
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="trace-input" className="text-sm font-medium text-gray-700">Input</label>
        <input
          id="trace-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
          disabled={!request}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-1 font-mono text-sm disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={loading || !draft.trim() || draft.trim() === request?.testCase.input}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Re-trace
        </button>
      </div>

      {totalSteps > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={controlClasses} onClick={() => onStepChange(step - 1)} disabled={step === 0}>
            ◀ Prev
          </button>
          <span aria-live="polite" className="min-w-[7rem] text-center text-sm text-gray-700">
            Step {step + 1} / {totalSteps}
          </span>
          <button
            type="button"
            className={controlClasses}
            onClick={() => onStepChange(step + 1)}
            disabled={step >= totalSteps - 1}
          >
            Next ▶
          </button>
          <button type="button" className={controlClasses} onClick={() => onStepChange(0)} disabled={step === 0}>
            Reset
          </button>
          {divergence !== null && (
            <button
              type="button"
              className={`${controlClasses} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}
              onClick={() => onStepChange(divergence)}
            >
              Go to first difference (step {divergence + 1})
            </button>
          )}
        </div>
      )}

      {divergence === null && sides.student && sides.llm && !loading && (
        <p className="mt-3 text-sm text-gray-600">
          Both runs took the same path on this input. Try another input to look for a difference.
        </p>
      )}

      {traceState.status === 'success' && traceState.warning && (
        <p role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          {traceState.warning}
        </p>
      )}

      {traceState.status === 'error' && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          <p className="font-semibold">Could not trace this input</p>
          <p className="mt-1">{traceState.error}</p>
        </div>
      )}
    </div>
  );
}
