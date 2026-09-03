import { CODE_ANALYSIS_URL } from '../config/apiConfig';
import { isObject } from './llmJson';
import { makeApiRequestWithRetry } from './llmClient';

export type SupportedLanguage = 'java' | 'python';

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

export interface CodeAnalysis {
  analysisVersion: 1;
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
  factsTruncated: boolean;
}

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
    input.analysisVersion !== 1 ||
    input.language !== expectedLanguage ||
    input.parser !== 'tree-sitter' ||
    (input.parseStatus !== 'clean' && input.parseStatus !== 'recovered') ||
    !isObject(input.source) ||
    !Array.isArray(input.functions) ||
    !Array.isArray(input.facts) ||
    !Array.isArray(input.syntaxIssues) ||
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

  return {
    analysisVersion: 1,
    language: expectedLanguage,
    parser: 'tree-sitter',
    parseStatus: input.parseStatus,
    source: { byteCount: sourceByteCount, lineCount: sourceLineCount },
    functions,
    facts,
    syntaxIssues,
    factsTruncated: input.factsTruncated,
  };
};

export const requestCodeAnalysis = async (
  language: SupportedLanguage,
  code: string
): Promise<CodeAnalysis> => {
  const response = await makeApiRequestWithRetry({
    url: CODE_ANALYSIS_URL,
    options: {
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
