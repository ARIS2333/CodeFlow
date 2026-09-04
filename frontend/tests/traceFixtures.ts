import type { FlowchartData, FlowchartSide } from '../src/lib/llmSchemas.ts';

/**
 * Two shapes of the same three-step solution whose only difference is the
 * comparison, which is what a trace is meant to expose.
 */
export const traceGraphs = (): FlowchartData => ({
  student: {
    nodes: [
      { id: '1', kind: 'start', data: { label: 'START' } },
      { id: '2', kind: 'condition', data: { label: 'a > b' } },
      { id: '3', kind: 'process', data: { label: 'sum = a' } },
      { id: '4', kind: 'process', data: { label: 'sum = b' } },
      { id: '5', kind: 'terminal', data: { label: 'return sum' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3', label: 'true' },
      { id: 'e2-4', source: '2', target: '4', label: 'false' },
      { id: 'e3-5', source: '3', target: '5' },
      { id: 'e4-5', source: '4', target: '5' },
    ],
  },
  llm: {
    nodes: [
      { id: '1', kind: 'start', data: { label: 'START' } },
      { id: '2', kind: 'condition', data: { label: 'a >= b' } },
      { id: '3', kind: 'process', data: { label: 'sum = a' } },
      { id: '4', kind: 'process', data: { label: 'sum = b' } },
      { id: '5', kind: 'terminal', data: { label: 'return sum' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3', label: 'true' },
      { id: 'e2-4', source: '2', target: '4', label: 'false' },
      { id: 'e3-5', source: '3', target: '5' },
      { id: 'e4-5', source: '4', target: '5' },
    ],
  },
});

const side = (ids: string[], finalOutput: string) => ({
  steps: ids.map((nodeId) => ({ nodeId, variables: { a: '3', b: '3' }, note: `at ${nodeId}` })),
  finalOutput,
  truncated: false,
});

/** a = 3, b = 3: the student takes the false branch, the reference takes true. */
export const traceReply = () => ({
  student: side(['1', '2', '4', '5'], '3'),
  llm: side(['1', '2', '3', '5'], '3'),
});

/** A graph with a real back edge, so a legal walk can be arbitrarily long. */
export const loopGraph = (): FlowchartSide => ({
  nodes: [
    { id: '1', kind: 'start', data: { label: 'START' } },
    { id: '2', kind: 'condition', data: { label: 'i < n' } },
    { id: '3', kind: 'process', data: { label: 'i = i + 1' } },
    { id: '4', kind: 'terminal', data: { label: 'return i' } },
  ],
  edges: [
    { id: 'e1-2', source: '1', target: '2' },
    { id: 'e2-3', source: '2', target: '3', label: 'true' },
    { id: 'e3-2', source: '3', target: '2', label: 'loop-back' },
    { id: 'e2-4', source: '2', target: '4', label: 'false' },
  ],
});
