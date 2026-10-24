import { CODE_ANALYSIS_URL } from '../config/apiConfig.ts';
import { isObject } from './llmJson.ts';
import { makeApiRequestWithRetry } from './llmClient.ts';

export type SupportedLanguage = 'java' | 'python' | 'cpp';

export type CodeFactKind = 'condition' | 'process' | 'terminal';

export interface SourcePosition {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startByte: number;
  endByte: number;
}

export interface CodeFact extends SourcePosition {
  anchor: string;
  kind: CodeFactKind;
  construct: string;
  text: string;
  parentAnchor: string | null;
  branch: string;
  function: string | null;
  flowchartRequired: boolean;
}

export interface SyntaxIssue extends SourcePosition {
  id: string;
  kind: string;
  text: string;
  expected?: string;
}

export interface CompileIssue extends SourcePosition {
  id: string;
  kind: string;
  text: string;
  expected?: string;
}

export interface AnalyzedFlowchartSide {
  nodes: Array<{
    id: string;
    kind: 'start' | 'condition' | 'process' | 'terminal' | 'end';
    sourceAnchors?: string[];
    data: { label: string };
  }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
}

export interface CodeAnalysis {
  analysisVersion: 2;
  language: SupportedLanguage;
  parser: 'tree-sitter';
  parseStatus: 'clean' | 'recovered';
  source: {
    byteCount: number;
    lineCount: number;
  };
  functions: Array<{
    name: string;
    construct: string;
  } & SourcePosition>;
  facts: CodeFact[];
  syntaxIssues: SyntaxIssue[];
  compileIssues: CompileIssue[];
  /** Result of the real C++ compiler gate; other languages use `not-run`. */
  compilerStatus?: 'not-run' | 'passed' | 'failed' | 'unavailable';
  factsTruncated: boolean;
  /** Deterministic CFG produced from the same Tree-sitter facts. */
  studentFlowchart: AnalyzedFlowchartSide;
}

export interface SyntaxDiagnostic {
  line: number;
  column: number;
  message: string;
  additionalCount: number;
}

export type CompileDiagnostic = SyntaxDiagnostic;

/**
 * Study tasks accept one submitted function only. Tree-sitter reports actual
 * definitions (not calls or prototypes), so this gate is deterministic and
 * does not ask the model to interpret whether a helper exists.
 */
export const multipleFunctionDefinitionMessage = (
  analysis: CodeAnalysis,
): string | undefined => {
  if (analysis.functions.length <= 1) return undefined;
  const names = analysis.functions
    .map(({ name }) => name.trim())
    .filter(Boolean);
  const uniqueNames = [...new Set(names)];
  const detail = uniqueNames.length
    ? ` Found ${analysis.functions.length}: ${uniqueNames.join(', ')}.`
    : ` Found ${analysis.functions.length} function definitions.`;
  return (
    'Only one function definition is allowed for this exercise.'
    + detail
    + ' Remove helper functions and keep only the function required by the problem.'
  );
};

/** Pick the first source-backed compiler diagnostic for the student UI. */
export const compileDiagnosticFor = (
  analysis?: CodeAnalysis,
): CompileDiagnostic | undefined => {
  const issue = analysis?.compileIssues[0];
  if (!issue) return undefined;
  return {
    line: issue.startLine,
    column: issue.startColumn,
    message: issue.text.trim() || 'The code did not compile.',
    additionalCount: Math.max(0, (analysis?.compileIssues.length ?? 0) - 1),
  };
};

/** Pick a concise, source-backed syntax message suitable for student UI. */
export const syntaxDiagnosticFor = (
  analysis?: CodeAnalysis,
): SyntaxDiagnostic | undefined => {
  if (!analysis?.syntaxIssues.length) return undefined;
  const issue = analysis.syntaxIssues.find(
    ({ kind }) => kind === 'python-syntax-error',
  ) ?? analysis.syntaxIssues[0];

  if (issue.kind === 'python-syntax-error' && issue.text.trim()) {
    return {
      line: issue.startLine,
      column: issue.startColumn,
      message: issue.text.trim(),
      additionalCount: Math.max(0, analysis.syntaxIssues.length - 1),
    };
  }
  if (issue.kind === 'missing-token' && issue.expected) {
    return {
      line: issue.startLine,
      column: issue.startColumn,
      message: `Expected ${issue.expected}.`,
      additionalCount: Math.max(0, analysis.syntaxIssues.length - 1),
    };
  }
  return {
    line: issue.startLine,
    column: issue.startColumn,
    message: 'Invalid or incomplete syntax.',
    additionalCount: Math.max(0, analysis.syntaxIssues.length - 1),
  };
};

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const parsePosition = (input: Record<string, unknown>): SourcePosition | null => {
  const startLine = asFiniteNumber(input.startLine);
  const startColumn = asFiniteNumber(input.startColumn);
  const endLine = asFiniteNumber(input.endLine);
  const endColumn = asFiniteNumber(input.endColumn);
  const startByte = asFiniteNumber(input.startByte);
  const endByte = asFiniteNumber(input.endByte);

  if (
    startLine === undefined ||
    startColumn === undefined ||
    endLine === undefined ||
    endColumn === undefined ||
    startByte === undefined ||
    endByte === undefined
  ) {
    return null;
  }

  return { startLine, startColumn, endLine, endColumn, startByte, endByte };
};

const validateAnalysis = (
  input: unknown,
  expectedLanguage: SupportedLanguage
): CodeAnalysis => {
  if (!isObject(input)) {
    throw new Error('code analysis: the backend response was not an object');
  }
  if (typeof input.error === 'string') {
    const details = typeof input.details === 'string' ? `: ${input.details}` : '';
    throw new Error(`code analysis: ${input.error}${details}`);
  }
  if (
    input.analysisVersion !== 2 ||
    input.language !== expectedLanguage ||
    input.parser !== 'tree-sitter' ||
    (input.parseStatus !== 'clean' && input.parseStatus !== 'recovered') ||
    !isObject(input.source) ||
    !Array.isArray(input.functions) ||
    !Array.isArray(input.facts) ||
    !Array.isArray(input.syntaxIssues) ||
    !Array.isArray(input.compileIssues) ||
    !isObject(input.studentFlowchart) ||
    !Array.isArray(input.studentFlowchart.nodes) ||
    !Array.isArray(input.studentFlowchart.edges) ||
    typeof input.factsTruncated !== 'boolean'
  ) {
    throw new Error('code analysis: the backend response has an invalid contract');
  }

  const sourceByteCount = asFiniteNumber(input.source.byteCount);
  const sourceLineCount = asFiniteNumber(input.source.lineCount);
  if (sourceByteCount === undefined || sourceLineCount === undefined) {
    throw new Error('code analysis: source size information is invalid');
  }

  const anchors = new Set<string>();
  const facts = input.facts.map((entry, index): CodeFact => {
    if (!isObject(entry)) {
      throw new Error(`code analysis: facts[${index}] is not an object`);
    }
    const position = parsePosition(entry);
    if (
      !position ||
      typeof entry.anchor !== 'string' ||
      !['condition', 'process', 'terminal'].includes(String(entry.kind)) ||
      typeof entry.construct !== 'string' ||
      typeof entry.text !== 'string' ||
      (entry.parentAnchor !== null && typeof entry.parentAnchor !== 'string') ||
      typeof entry.branch !== 'string' ||
      (entry.function !== null && typeof entry.function !== 'string') ||
      typeof entry.flowchartRequired !== 'boolean'
    ) {
      throw new Error(`code analysis: facts[${index}] is invalid`);
    }
    if (anchors.has(entry.anchor)) {
      throw new Error(`code analysis: duplicate anchor "${entry.anchor}"`);
    }
    anchors.add(entry.anchor);

    return {
      anchor: entry.anchor,
      kind: entry.kind as CodeFactKind,
      construct: entry.construct,
      text: entry.text,
      parentAnchor: entry.parentAnchor,
      branch: entry.branch,
      function: entry.function,
      flowchartRequired: entry.flowchartRequired,
      ...position,
    };
  });

  const functions = input.functions.map((entry, index) => {
    if (
      !isObject(entry) ||
      typeof entry.name !== 'string' ||
      typeof entry.construct !== 'string'
    ) {
      throw new Error(`code analysis: functions[${index}] is invalid`);
    }
    const position = parsePosition(entry);
    if (!position) {
      throw new Error(`code analysis: functions[${index}] has no source position`);
    }
    return { name: entry.name, construct: entry.construct, ...position };
  });

  const syntaxIssues = input.syntaxIssues.map((entry, index): SyntaxIssue => {
    if (
      !isObject(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.kind !== 'string' ||
      typeof entry.text !== 'string'
    ) {
      throw new Error(`code analysis: syntaxIssues[${index}] is invalid`);
    }
    const position = parsePosition(entry);
    if (!position) {
      throw new Error(`code analysis: syntaxIssues[${index}] has no source position`);
    }
    const issue: SyntaxIssue = {
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      ...position,
    };
    if (typeof entry.expected === 'string') issue.expected = entry.expected;
    return issue;
  });

  const compileIssues = input.compileIssues.map((entry, index): CompileIssue => {
    if (
      !isObject(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.kind !== 'string' ||
      typeof entry.text !== 'string'
    ) {
      throw new Error(`code analysis: compileIssues[${index}] is invalid`);
    }
    const position = parsePosition(entry);
    if (!position) {
      throw new Error(`code analysis: compileIssues[${index}] has no source position`);
    }
    const issue: CompileIssue = {
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      ...position,
    };
    if (typeof entry.expected === 'string') issue.expected = entry.expected;
    return issue;
  });

  const compilerStatus = input.compilerStatus;
  if (
    compilerStatus !== undefined
    && !['not-run', 'passed', 'failed', 'unavailable'].includes(String(compilerStatus))
  ) {
    throw new Error('code analysis: compilerStatus is invalid');
  }

  return {
    analysisVersion: 2,
    language: expectedLanguage,
    parser: 'tree-sitter',
    parseStatus: input.parseStatus,
    source: { byteCount: sourceByteCount, lineCount: sourceLineCount },
    functions,
    facts,
    syntaxIssues,
    compileIssues,
    ...(compilerStatus !== undefined
      ? { compilerStatus: compilerStatus as CodeAnalysis['compilerStatus'] }
      : {}),
    factsTruncated: input.factsTruncated,
    studentFlowchart: input.studentFlowchart as unknown as AnalyzedFlowchartSide,
  };
};

export const requestCodeAnalysis = async (
  language: SupportedLanguage,
  code: string,
  signal?: AbortSignal,
): Promise<CodeAnalysis> => {
  const response = await makeApiRequestWithRetry({
    url: CODE_ANALYSIS_URL,
    options: {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ language, code }),
    },
  });

  return validateAnalysis(await response.json(), language);
};
