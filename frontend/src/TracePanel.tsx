import { useEffect, useState } from 'react';
import type { TraceRequest, TraceState } from './lib/traceRun';

interface TracePanelProps {
  traceState: TraceState;
  onRetrace: (request: TraceRequest) => void;
}

const controlClasses =
  'rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 ' +
  'transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40';

export function TraceControls({ totalSteps, step, onStepChange }: {
  totalSteps: number;
  step: number;
  onStepChange: (step: number) => void;
}) {
  if (totalSteps <= 0) return null;

  return (
    <nav aria-label="Trace navigation" className="my-4 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
      <button type="button" className={controlClasses} onClick={() => onStepChange(0)} disabled={step === 0}>
        ⏮ Start
      </button>
      <button type="button" className={controlClasses} onClick={() => onStepChange(step - 1)} disabled={step === 0}>
        ◀ Prev
      </button>
      <span aria-live="polite" className="min-w-[7rem] text-center text-sm font-medium text-gray-700">
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
      <button type="button" className={controlClasses} onClick={() => onStepChange(totalSteps - 1)} disabled={step >= totalSteps - 1}>
        End ⏭
      </button>
      <button type="button" className={controlClasses} onClick={() => onStepChange(0)} disabled={step === 0}>
        Reset
      </button>
    </nav>
  );
}

export default function TracePanel({
  traceState,
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
          disabled={loading || !draft.trim()}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Re-trace
        </button>
      </div>

      {traceState.status === 'error' && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          <p className="font-semibold">Could not trace this input</p>
          <p className="mt-1">{traceState.error}</p>
        </div>
      )}
    </div>
  );
}
