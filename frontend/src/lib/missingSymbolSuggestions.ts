import { isObject } from './llmJson.ts';

// Syntax punctuation only: this feature does not propose operators, identifiers,
// or arbitrary code as a way of silently repairing the student's logic.
export const MISSING_SYMBOLS = ['(', ')', '{', '}', '[', ']', ':', ';', ',', '"', "'", '"""', "'''"];

export interface MissingSymbolSuggestion {
  symbol: string;
  explanation: string;
  location?: {
    line: number;
    anchor: string;
    placement: 'before' | 'after';
    /** Taken from the submitted source, never from the model's description. */
    sourceLine: string;
  };
}

/**
 * Optional model feedback must not reject an otherwise valid graph. Validate
 * source references, not parser facts or the correctness of a proposed repair.
 * An unmatched/ambiguous reference becomes an explicitly unlocated suggestion.
 * Undefined means no usable report, whereas [] is an explicit empty report.
 */
export const readMissingSymbolSuggestions = (
  input: unknown,
  code: string,
): MissingSymbolSuggestion[] | undefined => {
  if (!isObject(input) || !Array.isArray(input.missingSymbols)) return undefined;
  const lines = code.split(/\r\n|\n|\r/);
  const suggestions: MissingSymbolSuggestion[] = [];
  const seen = new Set<string>();

  for (const entry of input.missingSymbols.slice(0, 32)) {
    if (!isObject(entry) || typeof entry.symbol !== 'string' ||
        !MISSING_SYMBOLS.includes(entry.symbol) || typeof entry.explanation !== 'string' ||
        !entry.explanation.trim() || entry.explanation.length > 600) continue;

    const suggestion: MissingSymbolSuggestion = {
      symbol: entry.symbol,
      explanation: entry.explanation.trim(),
    };
    if (typeof entry.line === 'number' && Number.isInteger(entry.line) &&
        entry.line >= 1 && entry.line <= lines.length &&
        typeof entry.anchor === 'string' && entry.anchor.trim() &&
        (entry.placement === 'before' || entry.placement === 'after')) {
      const sourceLine = lines[entry.line - 1];
      const index = sourceLine.indexOf(entry.anchor);
      if (index >= 0 && index === sourceLine.lastIndexOf(entry.anchor)) {
        suggestion.location = {
          line: entry.line, anchor: entry.anchor, placement: entry.placement, sourceLine,
        };
      }
    }

    const key = JSON.stringify(suggestion);
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(suggestion);
    if (suggestions.length === 8) break;
  }

  // Do not let a malformed later reply erase a previous, usable report.
  return suggestions.length || input.missingSymbols.length === 0 ? suggestions : undefined;
};
