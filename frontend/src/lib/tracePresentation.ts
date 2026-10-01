import type { CodeAnalysis } from './codeAnalysis';
import type { TraceSide } from './executionTrace';
import type { FlowchartSide } from './llmSchemas';

export interface TraceVariableChange {
  name: string;
  value: string;
  previous?: string;
}

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
  if (step <= 0) return current.map(({ name, value }) => ({ name, value }));

  const previous = new Map(
    (trace.steps[step - 1]?.variables ?? []).map(({ name, value }) => [name, value]),
  );
  return current.flatMap(({ name, value }) => {
    const before = previous.get(name);
    if (before === value) return [];
    return [{ name, value, ...(before !== undefined ? { previous: before } : {}) }];
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
