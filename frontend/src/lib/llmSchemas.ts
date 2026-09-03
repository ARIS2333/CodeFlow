/**
 * Contract checks for the three LLM replies the app depends on.
 *
 * Each validator splits problems into two piles:
 *   repairs — the reply was salvageable, we fixed it and noted what we did
 *   errors  — the reply breaks the contract, the caller should ask again
 *
 * The dividing line is whether the app can still show the student something
 * correct. A missing optional field we can default; a node with no label, or an
 * edge pointing at a node that does not exist, is not worth rendering.
 */

import { isObject, type ValidationResult } from './llmJson.ts';
import type { CodeAnalysis } from './codeAnalysis';

export interface SyntaxErrorMark {
  symbol: string;
  occurrence?: number;
  expected?: string;
}

export type FlowchartNodeKind =
  | 'start'
  | 'condition'
  | 'process'
  | 'terminal'
  | 'end';

export interface FlowchartNode {
  id: string;
  kind: FlowchartNodeKind;
  sourceAnchors?: string[];
  data: {
    label: string;
    syntaxErrors?: SyntaxErrorMark[];
  };
}

export interface FlowchartEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface FlowchartSide {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

export interface FlowchartData {
  student: FlowchartSide;
  llm: FlowchartSide;
}

export interface Example {
  input: string;
  output: string;
}

export interface ProblemDetails {
  title: string;
  description: string;
  examples: Example[];
  constraints: string[];
}

export interface TestResult {
  input: string;
  expected: string;
  yourOutput: string;
}

export interface CodeEvaluationResponse {
  IsCorrect: boolean;
  TestResults: TestResult[];
}

/** Accept the scalar the model actually sent; only objects and null are refused. */
const asText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

/** Mirrors the lookup FlowchartDiagram does, so we reject marks it could not draw. */
const canLocateSymbol = (label: string, symbol: string, occurrence: number): boolean => {
  let from = 0;
  for (let i = 0; i < occurrence; i++) {
    const index = label.indexOf(symbol, from);
    if (index === -1) return false;
    from = index + symbol.length;
  }
  return true;
};

const FLOWCHART_NODE_KINDS = new Set<FlowchartNodeKind>([
  'start',
  'condition',
  'process',
  'terminal',
  'end',
]);

const validateSide = (
  side: 'student' | 'llm',
  raw: unknown,
  errors: string[],
  repairs: string[],
  codeAnalysis?: CodeAnalysis
): FlowchartSide | null => {
  if (!isObject(raw)) {
    errors.push(`"${side}" is missing or is not an object`);
    return null;
  }

  if (!Array.isArray(raw.nodes)) {
    errors.push(`"${side}.nodes" is missing or is not an array`);
    return null;
  }

  if (!Array.isArray(raw.edges)) {
    errors.push(`"${side}.edges" is missing or is not an array`);
    return null;
  }

  if (raw.nodes.length === 0) {
    errors.push(`"${side}.nodes" is empty; the flowchart needs at least a START node`);
    return null;
  }

  const nodeIds = new Set<string>();
  const nodes: FlowchartNode[] = [];

  raw.nodes.forEach((entry, index) => {
    const where = `${side}.nodes[${index}]`;

    if (!isObject(entry)) {
      errors.push(`${where} is not an object`);
      return;
    }

    const id = asText(entry.id)?.trim();
    if (!id) {
      errors.push(`${where} has no usable "id"`);
      return;
    }
    if (nodeIds.has(id)) {
      errors.push(`${where} reuses the id "${id}"; node ids must be unique`);
      return;
    }

    // Bound to a const so the narrowing survives into the closure below.
    const data = entry.data;
    if (!isObject(data)) {
      errors.push(`${where} (id "${id}") has no "data" object`);
      return;
    }

    const label = asText(data.label);
    if (label === undefined || !label.trim()) {
      errors.push(`${where} (id "${id}") has no "data.label" text`);
      return;
    }

    if (
      typeof entry.kind !== 'string' ||
      !FLOWCHART_NODE_KINDS.has(entry.kind as FlowchartNodeKind)
    ) {
      errors.push(
        `${where} (id "${id}") needs kind start, condition, process, terminal, or end`
      );
      return;
    }

    const node: FlowchartNode = {
      id,
      kind: entry.kind as FlowchartNodeKind,
      data: { label },
    };

    if (side === 'student' && !codeAnalysis && entry.sourceAnchors !== undefined) {
      // Inferred graphs have no parser facts to anchor to. Discard incidental
      // anchors instead of letting them reintroduce grounding constraints.
      repairs.push(`${where}: dropped sourceAnchors (no parser grounding)`);
    } else if (side === 'student' && entry.sourceAnchors !== undefined) {
      if (!Array.isArray(entry.sourceAnchors)) {
        errors.push(`${where}.sourceAnchors is not an array`);
        return;
      }
      const anchors: string[] = [];
      entry.sourceAnchors.forEach((anchor, anchorIndex) => {
        if (typeof anchor !== 'string' || !anchor.trim()) {
          errors.push(`${where}.sourceAnchors[${anchorIndex}] is not a usable string`);
          return;
        }
        const normalized = anchor.trim();
        if (anchors.includes(normalized)) {
          errors.push(`${where}.sourceAnchors repeats "${normalized}"`);
          return;
        }
        anchors.push(normalized);
      });
      if (anchors.length) node.sourceAnchors = anchors;
    } else if (side === 'llm' && entry.sourceAnchors !== undefined) {
      repairs.push(`${where}: dropped sourceAnchors (not allowed on the llm flow)`);
    }

    if (side === 'llm') {
      // The corrected flow carries a label and nothing else.
      const strays = ['hasError', 'errorMessage', 'syntaxErrors'].filter(
        (key) => data[key] !== undefined
      );
      if (strays.length) {
        repairs.push(`${where}: dropped ${strays.join(', ')} (not allowed on the llm flow)`);
      }
      nodeIds.add(id);
      nodes.push(node);
      return;
    }

    // Logic mistakes are never annotated — the student finds them by comparing
    // the two charts. Older prompts asked for these fields, so drop anything
    // the model still volunteers rather than letting it reach the renderer.
    const logicStrays = ['hasError', 'errorMessage'].filter(
      (key) => data[key] !== undefined
    );
    if (logicStrays.length) {
      repairs.push(
        `${where}: dropped ${logicStrays.join(', ')} (logic mistakes are not annotated)`
      );
    }

    const rawSyntaxErrors = data.syntaxErrors;
    if (rawSyntaxErrors !== undefined) {
      if (!Array.isArray(rawSyntaxErrors)) {
        repairs.push(`${where}: dropped "syntaxErrors", it was not an array`);
      } else {
        const marks: SyntaxErrorMark[] = [];

        rawSyntaxErrors.forEach((mark, markIndex) => {
          const at = `${where}.syntaxErrors[${markIndex}]`;

          if (!isObject(mark)) {
            repairs.push(`${at}: dropped, not an object`);
            return;
          }

          const symbol = asText(mark.symbol);
          if (!symbol) {
            repairs.push(`${at}: dropped, no "symbol" text`);
            return;
          }

          let occurrence = 1;
          if (mark.occurrence !== undefined) {
            const parsed = Number(mark.occurrence);
            if (Number.isInteger(parsed) && parsed >= 1) {
              occurrence = parsed;
            } else {
              repairs.push(`${at}: unusable "occurrence", defaulted to 1`);
            }
          }

          // Dropped rather than rejected: the node still renders and its logic
          // annotation — the part that matters most — is unaffected.
          if (!canLocateSymbol(label, symbol, occurrence)) {
            repairs.push(
              `${at}: dropped, "${symbol}" is not in the label "${label}"`
            );
            return;
          }

          const entryMark: SyntaxErrorMark = { symbol };
          if (occurrence > 1) entryMark.occurrence = occurrence;
          const expected = asText(mark.expected)?.trim();
          if (expected) entryMark.expected = expected;
          marks.push(entryMark);
        });

        if (marks.length) node.data.syntaxErrors = marks;
      }
    }

    nodeIds.add(id);
    nodes.push(node);
  });

  const edgeIds = new Set<string>();
  const edges: FlowchartEdge[] = [];

  raw.edges.forEach((entry, index) => {
    const where = `${side}.edges[${index}]`;

    if (!isObject(entry)) {
      errors.push(`${where} is not an object`);
      return;
    }

    const source = asText(entry.source)?.trim();
    const target = asText(entry.target)?.trim();

    if (!source || !target) {
      errors.push(`${where} is missing "source" or "target"`);
      return;
    }
    if (!nodeIds.has(source)) {
      errors.push(`${where} points from "${source}", which is not a node id`);
      return;
    }
    if (!nodeIds.has(target)) {
      errors.push(`${where} points to "${target}", which is not a node id`);
      return;
    }

    let id = asText(entry.id)?.trim() || `e${source}-${target}`;
    if (edgeIds.has(id)) {
      const unique = `${id}-${index}`;
      repairs.push(`${where}: edge id "${id}" was reused, renamed to "${unique}"`);
      id = unique;
    }
    edgeIds.add(id);

    const edge: FlowchartEdge = { id, source, target };
    const edgeLabel = asText(entry.label);
    if (edgeLabel) edge.label = edgeLabel;
    edges.push(edge);
  });

  if (side === 'student' && codeAnalysis) {
    const factsByAnchor = new Map(
      codeAnalysis.facts.map((fact, index) => [fact.anchor, { fact, index }])
    );
    const usedBy = new Map<string, string>();

    nodes.forEach((node) => {
      const anchorIndexes: number[] = [];
      node.sourceAnchors?.forEach((anchor) => {
        const anchoredFact = factsByAnchor.get(anchor);
        if (!anchoredFact) {
          errors.push(
            `student node "${node.id}" invents source anchor "${anchor}"`
          );
          return;
        }
        if (!anchoredFact.fact.flowchartRequired) {
          errors.push(
            `student node "${node.id}" uses unreachable source anchor "${anchor}"`
          );
        }
        anchorIndexes.push(anchoredFact.index);
        if (anchoredFact.fact.kind !== node.kind) {
          errors.push(
            `student node "${node.id}" has kind "${node.kind}" but anchor ` +
              `"${anchor}" is a "${anchoredFact.fact.kind}" fact`
          );
        }
        const previousNode = usedBy.get(anchor);
        if (previousNode) {
          errors.push(
            `source anchor "${anchor}" is reused by student nodes ` +
              `"${previousNode}" and "${node.id}"`
          );
          return;
        }
        usedBy.set(anchor, node.id);
      });

      if (anchorIndexes.length > 1) {
        if (node.kind !== 'process') {
          errors.push(
            `student node "${node.id}" combines anchors, but only process nodes may do that`
          );
        }
        const inSourceOrder = [...anchorIndexes].sort((a, b) => a - b);
        const consecutive = inSourceOrder.every(
          (index, position) =>
            position === 0 || index === inSourceOrder[position - 1] + 1
        );
        if (!consecutive) {
          errors.push(
            `student node "${node.id}" combines non-consecutive source anchors`
          );
        }
      }
    });

    const missingAnchors = codeAnalysis.facts
      .filter((fact) => fact.flowchartRequired)
      .map((fact) => fact.anchor)
      .filter((anchor) => !usedBy.has(anchor));
    if (missingAnchors.length) {
      errors.push(
        `student graph does not cover parser facts: ${missingAnchors.join(', ')}`
      );
    }
  }

  return { nodes, edges };
};

const validateGraphSemantics = (
  side: 'student' | 'llm',
  graph: FlowchartSide,
  errors: string[]
): void => {
  const starts = graph.nodes.filter((node) => node.kind === 'start');
  if (starts.length !== 1) {
    errors.push(`${side} graph needs exactly one start node; found ${starts.length}`);
    return;
  }

  const start = starts[0];
  if (start.id !== '1' || start.data.label.trim().toUpperCase() !== 'START') {
    errors.push(`${side} start node must have id "1" and label "START"`);
  }
  if (side === 'student' && start.sourceAnchors?.length) {
    errors.push('student start node cannot consume source anchors');
  }

  const outgoing = new Map<string, FlowchartEdge[]>();
  const incoming = new Map<string, FlowchartEdge[]>();
  graph.nodes.forEach((node) => {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  });

  const semanticEdges = new Set<string>();
  graph.edges.forEach((edge) => {
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
    const semanticKey = `${edge.source}\u0000${edge.target}\u0000${edge.label ?? ''}`;
    if (semanticEdges.has(semanticKey)) {
      errors.push(
        `${side} graph repeats edge ${edge.source} -> ${edge.target}` +
          (edge.label ? ` (${edge.label})` : '')
      );
    }
    semanticEdges.add(semanticKey);
  });

  if ((incoming.get(start.id)?.length ?? 0) > 0) {
    errors.push(`${side} start node cannot have incoming edges`);
  }

  graph.nodes.forEach((node) => {
    const edges = outgoing.get(node.id) ?? [];
    if (node.kind === 'terminal' || node.kind === 'end') {
      if (edges.length) {
        errors.push(
          `${side} ${node.kind} node "${node.id}" cannot have outgoing edges`
        );
      }
      if (node.kind === 'end' && node.data.label.trim().toUpperCase() !== 'END') {
        errors.push(`${side} end node "${node.id}" must use the neutral label "END"`);
      }
      return;
    }

    if (node.kind === 'start' && edges.length !== 1) {
      errors.push(`${side} start node must have exactly one outgoing edge`);
    } else if (node.kind === 'condition') {
      if (edges.length < 2) {
        errors.push(
          `${side} condition node "${node.id}" needs at least two outgoing edges`
        );
      }
      const labels = new Set<string>();
      edges.forEach((edge) => {
        const label = edge.label?.trim().toLowerCase();
        if (!label) {
          errors.push(
            `${side} condition node "${node.id}" has an unlabelled outgoing edge`
          );
        } else if (labels.has(label)) {
          errors.push(
            `${side} condition node "${node.id}" repeats branch label "${label}"`
          );
        } else {
          labels.add(label);
        }
      });
    } else if (node.kind === 'process' && edges.length !== 1) {
      errors.push(
        `${side} process node "${node.id}" must have exactly one outgoing edge`
      );
    }
  });

  const reachable = new Set<string>();
  const pending = [start.id];
  while (pending.length) {
    const id = pending.pop() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    (outgoing.get(id) ?? []).forEach((edge) => pending.push(edge.target));
  }

  const unreachable = graph.nodes
    .map((node) => node.id)
    .filter((id) => !reachable.has(id));
  if (unreachable.length) {
    errors.push(`${side} graph has unreachable nodes: ${unreachable.join(', ')}`);
  }
};

export const validateFlowchartSide = (
  side: 'student' | 'llm',
  input: unknown,
  codeAnalysis?: CodeAnalysis,
): ValidationResult<FlowchartSide> => {
  const errors: string[] = [];
  const repairs: string[] = [];
  const graph = validateSide(side, input, errors, repairs, codeAnalysis);
  if (graph && !errors.length) validateGraphSemantics(side, graph, errors);
  if (!graph || errors.length) return { ok: false, errors };
  return { ok: true, value: graph, repairs };
};

const validateFlowchartWithAnalysis = (
  input: unknown,
  codeAnalysis?: CodeAnalysis
): ValidationResult<FlowchartData> => {
  const errors: string[] = [];
  const repairs: string[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: ['the reply is not a JSON object'] };
  }

  const student = validateSide(
    'student',
    input.student,
    errors,
    repairs,
    codeAnalysis
  );
  const llm = validateSide('llm', input.llm, errors, repairs);

  if (errors.length || !student || !llm) {
    return { ok: false, errors: errors.length ? errors : ['the reply is missing a flowchart'] };
  }

  validateGraphSemantics('student', student, errors);
  validateGraphSemantics('llm', llm, errors);

  if (errors.length) return { ok: false, errors };

  return { ok: true, value: { student, llm }, repairs };
};

export const validateFlowchart = (
  input: unknown
): ValidationResult<FlowchartData> => validateFlowchartWithAnalysis(input);

export const createFlowchartValidator = (
  codeAnalysis: CodeAnalysis
): ((input: unknown) => ValidationResult<FlowchartData>) =>
  (input: unknown) => validateFlowchartWithAnalysis(input, codeAnalysis);

export const validateCodeEvaluation = (
  input: unknown
): ValidationResult<CodeEvaluationResponse> => {
  const errors: string[] = [];
  const repairs: string[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: ['the reply is not a JSON object'] };
  }

  let isCorrect: boolean;
  if (typeof input.IsCorrect === 'boolean') {
    isCorrect = input.IsCorrect;
  } else if (input.IsCorrect === 'true' || input.IsCorrect === 'false') {
    isCorrect = input.IsCorrect === 'true';
    repairs.push(`"IsCorrect" arrived as a string, read as ${isCorrect}`);
  } else {
    errors.push('"IsCorrect" is missing or is not a boolean');
    isCorrect = false;
  }

  if (!Array.isArray(input.TestResults)) {
    errors.push('"TestResults" is missing or is not an array');
    return { ok: false, errors };
  }

  if (input.TestResults.length === 0) {
    errors.push('"TestResults" is empty; at least one test case is required');
  }

  const testResults: TestResult[] = [];

  input.TestResults.forEach((entry, index) => {
    const where = `TestResults[${index}]`;

    if (!isObject(entry)) {
      errors.push(`${where} is not an object`);
      return;
    }

    const input_ = asText(entry.input);
    const expected = asText(entry.expected);
    // Read with .includes() when rendering, so a non-string here would crash.
    const yourOutput = asText(entry.yourOutput);

    const missing = [
      input_ === undefined && 'input',
      expected === undefined && 'expected',
      yourOutput === undefined && 'yourOutput',
    ].filter(Boolean);

    if (missing.length) {
      errors.push(`${where} is missing ${missing.join(', ')}`);
      return;
    }

    testResults.push({
      input: input_ as string,
      expected: expected as string,
      yourOutput: yourOutput as string,
    });
  });

  if (errors.length) return { ok: false, errors };

  return { ok: true, value: { IsCorrect: isCorrect, TestResults: testResults }, repairs };
};

export const validateProblemDetails = (input: unknown): ValidationResult<ProblemDetails> => {
  const errors: string[] = [];
  const repairs: string[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: ['the reply is not a JSON object'] };
  }

  const title = asText(input.title)?.trim();
  if (!title) errors.push('"title" is missing or empty');

  const description = asText(input.description)?.trim();
  if (!description) errors.push('"description" is missing or empty');

  const examples: Example[] = [];
  if (input.examples === undefined) {
    repairs.push('"examples" was missing, defaulted to an empty list');
  } else if (!Array.isArray(input.examples)) {
    errors.push('"examples" is not an array');
  } else {
    input.examples.forEach((entry, index) => {
      const where = `examples[${index}]`;

      if (!isObject(entry)) {
        errors.push(`${where} is not an object`);
        return;
      }

      const exampleInput = asText(entry.input);
      const exampleOutput = asText(entry.output);

      if (exampleInput === undefined || exampleOutput === undefined) {
        errors.push(`${where} needs both "input" and "output"`);
        return;
      }

      examples.push({ input: exampleInput, output: exampleOutput });
    });
  }

  const constraints: string[] = [];
  if (input.constraints === undefined) {
    repairs.push('"constraints" was missing, defaulted to an empty list');
  } else if (!Array.isArray(input.constraints)) {
    repairs.push('"constraints" was not an array, defaulted to an empty list');
  } else {
    input.constraints.forEach((entry) => {
      const text = asText(entry);
      if (text !== undefined) constraints.push(text);
    });
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title: title as string,
      description: description as string,
      examples,
      constraints,
    },
    repairs,
  };
};
