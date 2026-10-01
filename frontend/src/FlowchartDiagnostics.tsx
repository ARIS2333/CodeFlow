import type { FlowchartGenerationContext } from './lib/flowchartGeneration';
import type { EvaluationState } from './lib/analysisRun';

interface FlowchartDiagnosticsProps {
  generation?: FlowchartGenerationContext;
  evaluationState?: EvaluationState;
}

/** Explain why the displayed graph may not represent an executable program. */
export default function FlowchartDiagnostics({ generation, evaluationState }: FlowchartDiagnosticsProps) {
  const blockingVerdict = evaluationState?.status === 'success'
    ? evaluationState.data.TestResults
        .map(({ yourOutput }) => yourOutput.match(/(?:Compile|Syntax) Error/i)?.[0])
        .find(Boolean)
    : undefined;
  const inferred = generation?.mode === 'inferred';
  if (!inferred && !blockingVerdict) return null;
  return (
    <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <p className="font-semibold">
        {inferred ? 'Flowchart inferred from incomplete code' : 'Flowchart generated from code with an error'}
      </p>
      <p className="mt-1 text-sm">
        {blockingVerdict
          ? `The simulated run reported a ${blockingVerdict.toLowerCase()}. The flowchart shows the visible structure, but the program cannot run as written.`
          : 'The code could not be parsed cleanly. This flowchart interprets the visible structure and may not represent an executable program.'}
      </p>
    </div>
  );
}
