import { systemPrompt_GenerateFlowchart } from '../config/systemPrompt_GenerateFlowchart';
import { requestCodeAnalysis, type SupportedLanguage } from './codeAnalysis';
import type { CodeAnalysis } from './codeAnalysis';
import { requestStructured } from './llmClient';
import {
  createFlowchartValidator,
  type FlowchartData,
  type ProblemDetails,
} from './llmSchemas';

export interface FlowchartRequest {
  practice: ProblemDetails;
  language: SupportedLanguage;
  code: string;
}

const countOccurrences = (text: string, symbol: string): number => {
  let count = 0;
  let from = 0;
  while (from <= text.length - symbol.length) {
    const index = text.indexOf(symbol, from);
    if (index === -1) break;
    count++;
    from = index + symbol.length;
  }
  return count;
};

const visibleTokenBefore = (
  code: string,
  startByte: number,
  lowerByte: number,
  label: string
): string | undefined => {
  const encoded = new TextEncoder().encode(code);
  const prefix = new TextDecoder().decode(
    encoded.slice(Math.max(0, lowerByte), Math.max(0, startByte))
  );
  const tokens = prefix.match(
    /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|===|!==|==|!=|<=|>=|\+\+|--|&&|\|\||\S/g
  );
  return tokens?.reverse().find((token) => label.includes(token));
};

/**
 * Missing tokens are absent from a label by definition, so models often point
 * at the absent character and the renderer cannot locate it. Tree-sitter gives
 * us the exact gap: deterministically underline the nearest visible token and
 * retain the expected character as hover text.
 */
const applyMissingTokenMarks = (
  flowchart: FlowchartData,
  analysis: CodeAnalysis,
  code: string
): FlowchartData => {
  const studentNodes = flowchart.student.nodes.map((node) => ({
    ...node,
    sourceAnchors: node.sourceAnchors ? [...node.sourceAnchors] : undefined,
    data: {
      ...node.data,
      syntaxErrors: node.data.syntaxErrors
        ? node.data.syntaxErrors.map((mark) => ({ ...mark }))
        : undefined,
    },
  }));

  analysis.syntaxIssues
    .filter(
      (issue) => issue.kind === 'missing-token' && typeof issue.expected === 'string'
    )
    .forEach((issue) => {
      const fact = analysis.facts
        .filter(
          (candidate) =>
            candidate.startByte <= issue.startByte &&
            candidate.endByte >= issue.startByte
        )
        .sort(
          (left, right) =>
            left.endByte - left.startByte - (right.endByte - right.startByte)
        )[0];
      if (!fact) return;

      const node = studentNodes.find((candidate) =>
        candidate.sourceAnchors?.includes(fact.anchor)
      );
      if (!node) return;

      const symbol = visibleTokenBefore(
        code,
        issue.startByte,
        fact.startByte,
        node.data.label
      );
      if (!symbol) return;

      const occurrence = countOccurrences(node.data.label, symbol);
      if (occurrence < 1) return;
      const existing = node.data.syntaxErrors ?? [];
      if (
        existing.some(
          (mark) =>
            mark.symbol === symbol &&
            (mark.occurrence ?? 1) === occurrence &&
            mark.expected === issue.expected
        )
      ) {
        return;
      }

      node.data.syntaxErrors = [
        ...existing,
        {
          symbol,
          ...(occurrence > 1 ? { occurrence } : {}),
          expected: issue.expected,
        },
      ];
    });

  return {
    ...flowchart,
    student: { ...flowchart.student, nodes: studentNodes },
  };
};

/**
 * Build a flowchart in three deliberately separate stages:
 *   1. Tree-sitter records source-backed facts, even for incomplete code.
 *   2. The model produces a graph that must cover every recorded anchor.
 *   3. Local validation and parser-derived syntax marking finalize the graph.
 *
 * There is intentionally no second model reviewer: the normal path makes one
 * flowchart LLM request. requestStructured only asks again when the first reply
 * is malformed or violates the machine-checkable contract.
 */
export const requestReliableFlowchart = async (
  request: FlowchartRequest
): Promise<FlowchartData> => {
  const codeAnalysis = await requestCodeAnalysis(request.language, request.code);
  const validate = createFlowchartValidator(codeAnalysis);

  const flowchart = await requestStructured({
    systemPrompt: systemPrompt_GenerateFlowchart,
    message: JSON.stringify({ ...request, codeAnalysis }),
    validate,
    label: 'grounded flowchart',
    maxAttempts: 3,
  });

  return applyMissingTokenMarks(flowchart, codeAnalysis, request.code);
};
