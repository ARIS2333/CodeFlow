import type { FlowchartGenerationContext } from './lib/flowchartGeneration';

interface FlowchartDiagnosticsProps {
  generation?: FlowchartGenerationContext;
}

/** Compact model suggestions, independent of graph success or failure. */
export default function FlowchartDiagnostics({ generation }: FlowchartDiagnosticsProps) {
  if (generation?.mode !== 'inferred' || !generation.missingSymbols?.length) return null;

  return (
    <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <p className="font-semibold">Possible missing symbols detected</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {generation.missingSymbols.map((suggestion, index) => (
          <li key={index} className="break-words">
            <code className="font-semibold">{suggestion.symbol}</code>
            {' — '}
            {suggestion.location ? (
              <>Line {suggestion.location.line}, {suggestion.location.placement} <code>{suggestion.location.anchor}</code></>
            ) : 'Location unknown'}
          </li>
        ))}
      </ul>
    </div>
  );
}
