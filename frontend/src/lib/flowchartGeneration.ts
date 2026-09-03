import type { CodeAnalysis, SyntaxIssue } from './codeAnalysis';
import type { MissingSymbolSuggestion } from './missingSymbolSuggestions';
import type { FlowchartSide } from './llmSchemas';

export interface FlowchartProgress {
  attempt: number;
  student?: FlowchartSide;
  llm?: FlowchartSide;
}

export type FlowchartGenerationMode = 'grounded' | 'inferred';

/** Request metadata kept separately from the graph's nodes and edges. */
export interface FlowchartGenerationContext {
  mode: FlowchartGenerationMode;
  syntaxIssues: SyntaxIssue[];
  /** Validated model feedback; undefined until a usable report is received. */
  missingSymbols?: MissingSymbolSuggestion[];
}

export const getFlowchartGenerationContext = (
  analysis: CodeAnalysis
): FlowchartGenerationContext => ({
  // A clean parse is not proof of valid code. This switch only handles problems
  // actually reported by the parser; it is not a compiler or confidence score.
  mode: analysis.parseStatus === 'recovered' || analysis.syntaxIssues.length > 0
    ? 'inferred'
    : 'grounded',
  syntaxIssues: analysis.syntaxIssues.map((issue) => ({ ...issue })),
});
