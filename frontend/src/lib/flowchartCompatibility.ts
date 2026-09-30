import type { FlowchartData, FlowchartSide } from './llmSchemas';

/**
 * Trace steps refer to node ids, so a previous trace is reusable only when the
 * regenerated graph keeps the same trace-visible structure. Source anchors,
 * syntax marks, and array order do not affect replay and are intentionally
 * ignored.
 */
const traceSignature = (side: FlowchartSide): string => JSON.stringify({
  nodes: side.nodes
    .map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.data.label,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)),
  edges: side.edges
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      label: edge.label ?? '',
    }))
    .sort((left, right) =>
      left.source.localeCompare(right.source)
      || left.target.localeCompare(right.target)
      || left.label.localeCompare(right.label)
    ),
});

export const areFlowchartsTraceCompatible = (
  previous: FlowchartData,
  next: FlowchartData,
): boolean =>
  traceSignature(previous.student) === traceSignature(next.student)
  && traceSignature(previous.llm) === traceSignature(next.llm);
