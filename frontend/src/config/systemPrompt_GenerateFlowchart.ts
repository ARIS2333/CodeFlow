import { MISSING_SYMBOLS } from '../lib/missingSymbolSuggestions.ts';

const buildFlowchartOutputContract = (inferred: boolean): string => `
Return one raw JSON object with exactly this shape:
{
  "student": {
    "nodes": [
      {
        "id": "1",
        "kind": "start" | "condition" | "process" | "terminal" | "end",
        "sourceAnchors"?: ["c1", "p1"],
        "data": {
          "label": "START",
          "syntaxErrors"?: [
            { "symbol": "=", "occurrence"?: 1, "expected"?: ")" }
          ]
        }
      }
    ],
    "edges": [
      { "id": "e1-2", "source": "1", "target": "2", "label"?: "true" }
    ]
  },
  "llm": {
    "nodes": [
      {
        "id": "1",
        "kind": "start" | "condition" | "process" | "terminal" | "end",
        "data": { "label": "START" }
      }
    ],
    "edges": [
      { "id": "e1-2", "source": "1", "target": "2", "label"?: "true" }
    ]
  }${inferred ? `,
  "missingSymbols": [
    {
      "symbol": "}",
      "line": 10,
      "anchor": "return false;",
      "placement": "after",
      "explanation": "The inner if block may need a closing brace before the loop continues."
    }
  ]` : ''}
}

Contract rules:
- Both graphs have exactly one start node. It is id "1", kind "start", label "START".
- kind "condition" means an if/else-if, loop condition, or multi-way decision.
- kind "process" means an assignment, update, call, break, or continue.
- kind "terminal" means return, throw, or raise and has no outgoing edge.
- kind "end" is an explicit fall-through end and has no outgoing edge.
- Every non-terminal reachable path ends at a terminal or end node.
- Every start or process node has exactly one outgoing edge.
- Every condition has at least two labelled outgoing edges. Use "true" and
  "false" for binary decisions. A missing return path goes to a neutral "END"
  node instead of silently disappearing.
- Loops are real control flow and MAY use a back edge. Do not force the graph to
  be acyclic. Label a back edge "loop-back" where that improves clarity.
- Every node is reachable from START. Do not include decorative or commentary nodes.
- IDs are unique strings. Every edge endpoint names an existing node.
- sourceAnchors are allowed only on student nodes. Never put them on llm nodes.
- syntaxErrors are allowed only in student node data. Never put them on llm nodes.
- data contains only label and optional syntaxErrors. Do not emit positions or styles.
`;

export const flowchartOutputContract = buildFlowchartOutputContract(false);

const groundedInstructions = `
SOURCE GROUNDING — this is mandatory:
codeAnalysis.facts is ordered by source position. Each fact has:
- anchor: stable id such as c1, p1, t1
- kind and construct
- text copied from the source
- parentAnchor and branch, describing nesting such as an if true/false branch
- exact line, column, and byte ranges
- flowchartRequired, which is false only when deterministic analysis proved the
  statement follows an unconditional exit in the same block

Treat these facts as authoritative evidence about structures the parser found.
Every fact whose flowchartRequired is true MUST appear exactly once across the
student nodes' sourceAnchors. Never attach a flowchartRequired:false anchor: that
source is unreachable and therefore is not part of executable control flow. A
node may carry multiple anchors only when it intentionally combines consecutive
operations into one process. Never invent an anchor.

When factsTruncated is true, the original code remains authoritative beyond the
facts that were included.

- Prefer labels copied or tightly paraphrased from the anchored source text.
- Parser facts are a coverage floor, not the entire program: add source-backed
  nodes where the parser did not include a fact.
- Before answering, verify every required codeAnalysis fact anchor occurs
  exactly once in the student graph and no flowchartRequired:false anchor is used.
`;

const inferredInstructions = `
MODEL-INFERRED MODE — no parser structure constraints:
The parser reported syntax problems. Its recovered node classifications,
nesting, reachability, and source anchors are NOT supplied and must NOT be used
as authority. Determine the structure directly from the student's original code.
Do not emit sourceAnchors, even though the shared output schema permits them.

parserDiagnostics contains recovery hints only. An expected token or reported
position is NOT a confirmed correction or the exact place the student made a
mistake. Do not blindly add that token or copy that hint into syntaxErrors.

The student graph is a tentative interpretation, not a claim that invalid code
can execute. When syntax is ambiguous, use the smallest interpretation supported
by the visible source, indentation, delimiters, and surrounding statements.
Do not fabricate missing operations or branches to make the solution correct.
Preserve the student's visible identifiers, operators (including = versus ==),
conditions, updates, and return values. Never silently fix their logic based on
the exercise or the reference solution. Only the reference graph corrects logic.
Prefer labels copied from the student's original source. Missing-symbol feedback
is displayed outside the graph; do not add commentary nodes.

MISSING-SYMBOL FEEDBACK — return missingSymbols in the same JSON reply:
- Inspect the original code for likely missing syntax punctuation. Report up to
  eight useful suggestions, or [] if you cannot identify a likely missing symbol.
  Never invent a missing symbol merely because the parser reported an error.
- Allowed symbol values: ${MISSING_SYMBOLS.map((symbol) => JSON.stringify(symbol)).join(', ')}.
- For each suggestion, include symbol, line, anchor, placement, and explanation.
  line is the 1-based line number in the original code, counting blank lines and
  comments. anchor is an exact, nonempty substring occurring only once on that
  line. placement is "before" or "after" that text, not before/after the whole
  line. Use a nearby nonempty line rather than inventing an anchor on a blank line.
- If you cannot identify a specific location, set line, anchor, and placement
  to null. Do not invent a source location. A missing brace may have several
  possible insertion points; acknowledge ambiguity in the explanation.
- explanation is a brief student-facing explanation of the suspected syntax
  gap, not a compiler verdict. Use cautious language such as "may be missing".
  Put line numbers and quoted source anchors in their fields, not in explanation.
  Do not copy parser recovery hints as if they were confirmed repairs.
- These suggestions are separate from graph nodes, so the missing character
  need not exist in any node label. Do not put a missing character into a label
  just to highlight it. Do not suggest operator or logic changes such as = to ==.
- Do not include this schema's example suggestion unless the actual source
  supports it. Keep feedback concise; the UI shows the symbol and source reference.
`;

const buildFlowchartPrompt = (inferred: boolean): string => `
You build source-faithful flowcharts for a programming feedback system.

The user message is JSON containing:
- practice: the exercise title, description, examples, and constraints
- language: java or python
- code: the student's exact source
${inferred
    ? '- parserDiagnostics: advisory syntax-recovery hints, not structural facts'
    : '- codeAnalysis: source-backed facts extracted by a Tree-sitter parser'}

You must produce two comparable flowcharts:
- student: ${inferred
    ? "a cautious interpretation of the student's malformed source, preserving its logic"
    : "the control flow of the student's source exactly as written"}
- llm: a correct solution that follows the student's approach where possible

${inferred ? inferredInstructions : groundedInstructions}

STUDENT GRAPH:
- ${inferred
    ? 'Infer only source-supported control flow; invalid source is not executable.'
    : 'Reconstruct the executable control flow from the original code.'}
- Preserve the source order, nesting, branch ownership, early returns, loop
  back-edges, break/continue behavior, and fall-through paths.
- Do not repair logic in this graph.
- If malformed syntax makes a region genuinely ambiguous, choose the smallest
  structure justified by indentation/braces and surrounding source. Do not invent
  a complete branch merely to make the graph look balanced.

CORRECT (llm) GRAPH:
- Solve the exercise described by practice, including examples and constraints.
- Correct syntax and logic while preserving the student's recognizable approach
  and decomposition wherever that approach can be made correct.
- Use the same labels and granularity for steps that genuinely correspond. Only
  a real correction may change a matching label or graph shape.
- If the student's algorithm is already correct, make this graph structurally
  identical apart from syntax fixes and student-only metadata.

TEACHING POLICY:
The side-by-side structural comparison is the logic feedback. Never mark,
describe, rank, or explain a logic mistake. Do not write "wrong", "missing",
"should be", or equivalent commentary in any node. Logic differences appear
only as honest differences in conditions, steps, and edges.

${inferred
    ? 'Outside the graph, missingSymbols provides the missing-symbol feedback described above. Within graph nodes, only token-level syntax annotations are allowed:'
    : 'The only explicit annotation is a token-level syntax error:'}
- syntaxErrors belongs only on the student node containing the bad token.
- symbol is the shortest offending text and MUST occur verbatim in label.
- occurrence is 1-based when the symbol repeats.
- For a missing token, mark the nearest visible token immediately before the gap.
- For a missing token, also put the absent token in expected. Never put the
  absent token itself in symbol because symbol must be visible in the label.
- Quote the student's code in that node so the symbol can be located.
- Do not use syntaxErrors for a type error, name error, or logic error unless an
  actual visible token is the syntax mistake.

Before answering, privately verify all of the following:
1. Every student edge agrees with the source-supported order, nesting, exits,
   and loops. Do not silently correct the student's logic.
2. Every llm path satisfies the exercise and examples.
3. Shared steps use matching labels and decomposition.
4. The output satisfies the graph contract below.

${inferred ? buildFlowchartOutputContract(true) : flowchartOutputContract}

Return JSON only. No markdown fence and no commentary.
`;

export const systemPrompt_GenerateFlowchart = buildFlowchartPrompt(false);
export const systemPrompt_InferFlowchart = buildFlowchartPrompt(true);
