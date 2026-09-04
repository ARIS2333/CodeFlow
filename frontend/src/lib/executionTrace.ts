/**
 * Contract checks for the step-by-step execution trace.
 *
 * A trace is only worth showing if the panel can actually walk it on the
 * flowchart the student is looking at. So the machine-checkable part is
 * navigational, not pedagogical: every step must name a node that exists in
 * its own graph, and consecutive steps must be joined by an edge that is
 * really drawn. A trace that teleports between nodes would animate as
 * nonsense, so those are errors worth a fresh attempt.
 *
 * We deliberately do NOT check whether the model simulated the program
 * correctly — that is not decidable here. The one honest cross-check we can
 * make (does the student trace end where the test run said it ended?) lives in
 * traceRun.ts and is reported to the student as a caveat, never as a rejection.
 */

import { isObject, type ValidationResult } from './llmJson.ts';
import { asText, type FlowchartData, type FlowchartSide } from './llmSchemas.ts';

/** Loops make traces unbounded; past this the student is not reading anyway. */
export const MAX_TRACE_STEPS = 120;
const MAX_VARIABLES = 8;
const MAX_VALUE_LENGTH = 120;
const MAX_NOTE_LENGTH = 300;

export interface TraceVariable {
  name: string;
  value: string;
}

export interface TraceStep {
  nodeId: string;
  /**
   * Label of the edge leaving this step, derived locally from the next step
   * rather than taken from the model, so it always matches the drawn edge.
   */
  branch?: string;
  variables: TraceVariable[];
  note: string;
}

export interface TraceSide {
  steps: TraceStep[];
  finalOutput: string;
  /** True when execution was cut off rather than reaching an exit node. */
  truncated: boolean;
}

export interface ExecutionTrace {
  student: TraceSide;
  llm: TraceSide;
}

export type TraceSideKey = keyof ExecutionTrace;

const readVariables = (
  raw: unknown,
  where: string,
  repairs: string[]
): TraceVariable[] => {
  if (raw === undefined || raw === null) return [];
  if (!isObject(raw)) {
    repairs.push(`${where} has a non-object "variables"; it was dropped`);
    return [];
  }

  const variables: TraceVariable[] = [];
  let dropped = 0;
  for (const [name, value] of Object.entries(raw)) {
    if (!name.trim()) continue;
    const text = asText(value);
    if (text === undefined) {
      // A nested object/array is a state dump, not a value a student reads.
      dropped++;
      continue;
    }
    if (variables.length === MAX_VARIABLES) {
      dropped++;
      continue;
    }
    variables.push({
      name: name.trim(),
      value: text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text,
    });
  }
  if (dropped) {
    repairs.push(`${where} dropped ${dropped} variable(s) that were unusable or over the limit`);
  }
  return variables;
};

const validateTraceSide = (
  side: TraceSideKey,
  raw: unknown,
  graph: FlowchartSide,
  errors: string[],
  repairs: string[]
): TraceSide | null => {
  if (!isObject(raw)) {
    errors.push(`"${side}" is missing or is not an object`);
    return null;
  }
  if (!Array.isArray(raw.steps)) {
    errors.push(`"${side}.steps" is missing or is not an array`);
    return null;
  }
  if (!raw.steps.length) {
    errors.push(`"${side}.steps" is empty; a trace starts at the start node`);
    return null;
  }

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const links = new Map<string, Array<{ target: string; label?: string }>>();
  graph.edges.forEach((edge) => {
    const list = links.get(edge.source);
    const link = { target: edge.target, ...(edge.label ? { label: edge.label } : {}) };
    if (list) list.push(link);
    else links.set(edge.source, [link]);
  });

  let truncated = raw.truncated === true;
  let entries: unknown[] = raw.steps;
  if (entries.length > MAX_TRACE_STEPS) {
    repairs.push(`"${side}.steps" was cut to the first ${MAX_TRACE_STEPS} steps`);
    entries = entries.slice(0, MAX_TRACE_STEPS);
    truncated = true;
  }

  const steps: TraceStep[] = [];
  let unusable = false;
  entries.forEach((entry, index) => {
    const where = `${side}.steps[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${where} is not an object`);
      unusable = true;
      return;
    }
    const nodeId = asText(entry.nodeId)?.trim();
    if (!nodeId) {
      errors.push(`${where} has no "nodeId"`);
      unusable = true;
      return;
    }
    if (!nodes.has(nodeId)) {
      errors.push(`${where} names node "${nodeId}", which is not in the ${side} flowchart`);
      unusable = true;
      return;
    }
    const note = asText(entry.note)?.trim() ?? '';
    if (!note) repairs.push(`${where} has no "note"`);
    steps.push({
      nodeId,
      variables: readVariables(entry.variables, where, repairs),
      note: note.length > MAX_NOTE_LENGTH ? `${note.slice(0, MAX_NOTE_LENGTH - 1)}…` : note,
    });
  });

  if (unusable) return null;

  const start = graph.nodes.find((node) => node.kind === 'start');
  if (start && steps[0].nodeId !== start.id) {
    errors.push(
      `"${side}.steps" begins at node "${steps[0].nodeId}"; it must begin at the start node "${start.id}"`
    );
  }

  for (let index = 1; index < steps.length; index++) {
    const from = steps[index - 1];
    const to = steps[index];
    const taken = (links.get(from.nodeId) ?? []).find((link) => link.target === to.nodeId);
    if (!taken) {
      // One report is enough: every later step is measured from a path the
      // flowchart does not contain, so listing them adds no information.
      errors.push(
        `${side}.steps[${index}] moves from node "${from.nodeId}" to "${to.nodeId}", ` +
          'but the flowchart has no edge between them'
      );
      break;
    }
    if (taken.label) from.branch = taken.label;
  }

  if (errors.length) return null;

  const last = nodes.get(steps[steps.length - 1].nodeId);
  if (!truncated && last && last.kind !== 'terminal' && last.kind !== 'end') {
    repairs.push(
      `"${side}" stopped at node "${last.id}", which is not an exit; shown as incomplete`
    );
    truncated = true;
  }

  const finalOutput = asText(raw.finalOutput)?.trim() ?? '';
  if (!finalOutput && !truncated) repairs.push(`"${side}" reported no finalOutput`);

  return { steps, finalOutput, truncated };
};

const validateWithGraphs = (
  input: unknown,
  graphs: FlowchartData
): ValidationResult<ExecutionTrace> => {
  const errors: string[] = [];
  const repairs: string[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: ['the reply is not a JSON object'] };
  }

  const student = validateTraceSide('student', input.student, graphs.student, errors, repairs);
  const llm = validateTraceSide('llm', input.llm, graphs.llm, errors, repairs);

  if (errors.length || !student || !llm) {
    return { ok: false, errors: errors.length ? errors : ['the reply is missing a trace'] };
  }

  return { ok: true, value: { student, llm }, repairs };
};

export const createTraceValidator = (
  graphs: FlowchartData
): ((input: unknown) => ValidationResult<ExecutionTrace>) =>
  (input: unknown) => validateWithGraphs(input, graphs);

/** Validate one side on its own, so it can be displayed while the other streams. */
export const validateTraceSideOnly = (
  side: TraceSideKey,
  input: unknown,
  graph: FlowchartSide
): ValidationResult<TraceSide> => {
  const errors: string[] = [];
  const repairs: string[] = [];
  const value = validateTraceSide(side, input, graph, errors, repairs);
  if (!value || errors.length) return { ok: false, errors };
  return { ok: true, value, repairs };
};

const normalizeLabel = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The first step at which the two traces stop doing the same thing.
 *
 * Node ids are per-graph, so the comparison is by label: the flowchart prompt
 * requires corresponding steps to share labels, which makes an honest label
 * difference exactly the divergence the student should look at. Returns null
 * when the two runs matched all the way through.
 */
export const traceDivergenceIndex = (
  trace: ExecutionTrace,
  graphs: FlowchartData
): number | null => {
  const labelsOf = (side: TraceSide, graph: FlowchartSide) => {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    return side.steps.map((step) => normalizeLabel(byId.get(step.nodeId)?.data.label ?? ''));
  };
  const student = labelsOf(trace.student, graphs.student);
  const llm = labelsOf(trace.llm, graphs.llm);
  const shared = Math.min(student.length, llm.length);
  for (let index = 0; index < shared; index++) {
    if (student[index] !== llm[index]) return index;
  }
  return student.length === llm.length ? null : shared;
};
