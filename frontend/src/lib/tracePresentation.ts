import type { CodeAnalysis } from './codeAnalysis';
import type { TraceSide } from './executionTrace';
import type { FlowchartSide } from './llmSchemas';

export interface TraceVariableChange {
  name: string;
  value: string;
  previous?: string;
  kind: 'new' | 'changed';
}

const splitTopLevel = (value: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if ('[{('.includes(character)) depth += 1;
    else if (']})'.includes(character)) depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
};

const topLevelColon = (value: string): number => {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if ('[{('.includes(character)) depth += 1;
    else if (']})'.includes(character)) depth -= 1;
    else if (character === ':' && depth === 0) return index;
  }
  return -1;
};

const readMap = (value: string): Map<string, string> | undefined => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return new Map();
  const result = new Map<string, string>();
  for (const entry of splitTopLevel(body)) {
    const colon = topLevelColon(entry);
    if (colon < 1) return undefined;
    result.set(entry.slice(0, colon).trim(), entry.slice(colon + 1).trim());
  }
  return result;
};

const mapChanges = (
  name: string,
  previous: string,
  value: string,
): TraceVariableChange[] | undefined => {
  const before = readMap(previous);
  const after = readMap(value);
  if (!before || !after) return undefined;
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return keys.flatMap((key) => {
    const oldValue = before.get(key);
    const newValue = after.get(key);
    if (oldValue === newValue || newValue === undefined) return [];
    return [{
      name: `${name}[${key}]`,
      value: newValue,
      ...(oldValue !== undefined ? { previous: oldValue } : {}),
      kind: oldValue === undefined ? 'new' as const : 'changed' as const,
    }];
  });
};

const sequenceChanges = (
  name: string,
  previous: string,
  value: string,
): TraceVariableChange[] | undefined => {
  const beforeText = previous.trim();
  const afterText = value.trim();
  if (!beforeText.startsWith('[') || !beforeText.endsWith(']')
    || !afterText.startsWith('[') || !afterText.endsWith(']')) return undefined;
  const before = splitTopLevel(beforeText.slice(1, -1));
  const after = splitTopLevel(afterText.slice(1, -1));
  if (before.length !== after.length) return undefined;
  return after.flatMap((entry, index) => entry === before[index] ? [] : [{
    name: `${name}[${index}]`,
    previous: before[index],
    value: entry,
    kind: 'changed' as const,
  }]);
};

/** Keep variable cards in the order variables first appeared during the run. */
export const orderedTraceVariables = (trace: TraceSide, step: number) => {
  const current = trace.steps[step]?.variables ?? [];
  const firstSeen = new Map<string, number>();
  trace.steps.forEach((entry) => entry.variables.forEach(({ name }) => {
    if (!firstSeen.has(name)) firstSeen.set(name, firstSeen.size);
  }));
  return [...current].sort((left, right) =>
    (firstSeen.get(left.name) ?? Number.MAX_SAFE_INTEGER)
      - (firstSeen.get(right.name) ?? Number.MAX_SAFE_INTEGER));
};

/**
 * Show what became visible or changed at this step. A missing variable is not
 * called "removed": the trace contract may omit out-of-scope or low-priority
 * values, so treating absence as a runtime deletion would overstate the data.
 */
export const traceVariableChanges = (
  trace: TraceSide,
  step: number,
): TraceVariableChange[] => {
  const current = trace.steps[step]?.variables ?? [];
  if (step <= 0) return current.map(({ name, value }) => ({ name, value, kind: 'new' }));

  const previous = new Map(
    (trace.steps[step - 1]?.variables ?? []).map(({ name, value }) => [name, value]),
  );
  return current.flatMap(({ name, value }) => {
    const before = previous.get(name);
    if (before === value) return [];
    if (before !== undefined) {
      const detailed = mapChanges(name, before, value)
        ?? sequenceChanges(name, before, value);
      if (detailed?.length) return detailed;
    }
    return [{
      name,
      value,
      ...(before !== undefined ? { previous: before } : {}),
      kind: before === undefined ? 'new' : 'changed',
    }];
  });
};

export interface TraceSourceReference {
  startLine: number;
  endLine: number;
  text: string;
}

/** Resolve a grounded student node back to exact source lines. */
export const traceSourceReference = (
  graph: FlowchartSide,
  nodeId: string,
  analysis?: CodeAnalysis,
  code?: string,
): TraceSourceReference | undefined => {
  if (!analysis || !code) return undefined;
  const anchors = graph.nodes.find((node) => node.id === nodeId)?.sourceAnchors;
  if (!anchors?.length) return undefined;

  const anchorSet = new Set(anchors);
  const facts = analysis.facts.filter((fact) => anchorSet.has(fact.anchor));
  if (!facts.length) return undefined;

  const startLine = Math.min(...facts.map((fact) => fact.startLine));
  const endLine = Math.max(...facts.map((fact) => fact.endLine));
  const lines = code.split(/\r?\n/).slice(startLine - 1, endLine);
  if (!lines.length) return undefined;

  const text = lines.join('\n').trim();
  if (!text) return undefined;
  return { startLine, endLine, text };
};
