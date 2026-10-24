import {
  systemPrompt_GenerateRecommendedCode,
} from '../config/systemPrompt_GenerateFlowchart.ts';
import { requestCodeAnalysis, type SupportedLanguage } from './codeAnalysis.ts';
import type { CodeAnalysis } from './codeAnalysis';
import { requestStructured } from './llmClient.ts';
import type { ModelConfigPayload } from './modelSettings.ts';
import { isObject, type ValidationResult } from './llmJson.ts';
import {
  getFlowchartGenerationContext,
  type FlowchartGenerationContext,
  type FlowchartProgress,
} from './flowchartGeneration.ts';
import {
  validateFlowchartSide,
  type FlowchartData,
  type ProblemDetails,
} from './llmSchemas.ts';

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
  if (!analysis.syntaxIssues.length) return flowchart;
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
 * Build both visible graphs through one deterministic program-analysis path.
 * Tree-sitter/CFG creates the student's graph directly. The model only proposes
 * corrected source code; that code must pass source analysis before the same CFG
 * builder is allowed to create the recommended graph.
 */
export const requestReliableFlowchart = async (
  request: FlowchartRequest,
  options: {
    /** Which model to call; travels beside the prompt, never inside it. */
    modelConfig: ModelConfigPayload;
    /** Fires once the grounded/inferred decision is made, before the model call. */
    onGenerationReady?: (context: FlowchartGenerationContext) => void;
    onProgress?: (progress: FlowchartProgress) => void;
    /** Reuse a preflight shared with feedback so one run parses source once. */
    codeAnalysis?: Promise<CodeAnalysis>;
    signal?: AbortSignal;
  },
): Promise<FlowchartData> => {
  const codeAnalysis = await (
    options.codeAnalysis ?? requestCodeAnalysis(request.language, request.code, options.signal)
  );
  options.signal?.throwIfAborted();
  const context = getFlowchartGenerationContext(codeAnalysis);
  options.onGenerationReady?.(context);
  const studentResult = validateFlowchartSide(
    'student', codeAnalysis.studentFlowchart, codeAnalysis,
  );
  if (!studentResult.ok) {
    throw new Error(`deterministic student flowchart: ${studentResult.errors.join('; ')}`);
  }
  const student = applyMissingTokenMarks(
    { student: studentResult.value, llm: studentResult.value },
    codeAnalysis,
    request.code,
  ).student;
  let previousAttemptDiagnostics: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const progress: FlowchartProgress = { attempt, student };
    options.onProgress?.(progress);
    const recommendation = await requestStructured({
      modelConfig: options.modelConfig,
      systemPrompt: systemPrompt_GenerateRecommendedCode,
      message: JSON.stringify({
        practice: request.practice,
        language: request.language,
        studentCode: request.code,
        parserDiagnostics: codeAnalysis.syntaxIssues,
        compilerDiagnostics: codeAnalysis.compileIssues,
        ...(previousAttemptDiagnostics.length ? { previousAttemptDiagnostics } : {}),
      }),
      validate: validateRecommendedCode,
      signal: options.signal,
      label: 'recommended code',
      maxAttempts: 2,
    });
    const recommendedAnalysis = await requestCodeAnalysis(
      request.language, recommendation.recommendedCode, options.signal,
    );
    previousAttemptDiagnostics = [
      ...recommendedAnalysis.syntaxIssues.map((issue) => issue.text || issue.kind),
      ...recommendedAnalysis.compileIssues.map((issue) => issue.text || issue.kind),
    ];
    const compilationFailed = recommendedAnalysis.compilerStatus === 'failed';
    if (previousAttemptDiagnostics.length || compilationFailed) continue;

    const recommendedRaw = {
      nodes: recommendedAnalysis.studentFlowchart.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        data: { ...node.data },
      })),
      edges: recommendedAnalysis.studentFlowchart.edges,
    };
    const recommendedResult = validateFlowchartSide('llm', recommendedRaw);
    if (!recommendedResult.ok) {
      previousAttemptDiagnostics = recommendedResult.errors;
      continue;
    }
    const flowchart: FlowchartData = {
      student,
      llm: recommendedResult.value,
      recommendedCode: recommendation.recommendedCode,
    };
    options.onProgress?.({ ...progress, llm: recommendedResult.value });
    return flowchart;
  }

  throw new Error(
    `recommended code could not be compiled after two attempts${
      previousAttemptDiagnostics.length ? `: ${previousAttemptDiagnostics.join('; ')}` : ''
    }`,
  );
};

interface RecommendedCode {
  approachSummary: string;
  recommendedCode: string;
}

const validateRecommendedCode = (input: unknown): ValidationResult<RecommendedCode> => {
  if (!isObject(input)) return { ok: false, errors: ['the reply is not an object'] };
  if (typeof input.approachSummary !== 'string' || !input.approachSummary.trim()) {
    return { ok: false, errors: ['approachSummary must be a nonempty string'] };
  }
  if (typeof input.recommendedCode !== 'string' || !input.recommendedCode.trim()) {
    return { ok: false, errors: ['recommendedCode must be nonempty source code'] };
  }
  return {
    ok: true,
    value: {
      approachSummary: input.approachSummary.trim(),
      recommendedCode: input.recommendedCode,
    },
    repairs: [],
  };
};
