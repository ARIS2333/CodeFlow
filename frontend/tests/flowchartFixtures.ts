import type { CodeAnalysis, SyntaxIssue, SupportedLanguage } from '../src/lib/codeAnalysis.ts';
import type { FlowchartData } from '../src/lib/llmSchemas.ts';

export const missingElseBrace = `public boolean in1To10(int n, boolean outsideMode) {
if (OutsideMode = true) {
if (n <= 1) {
return true;
} else {
return false;
} else if (n >= 1 && n <= 10) {
    return true;
} else {
    return false;
}
}`;

export const missingPalindromeBrace = `class Solution {
    public boolean isPalindrome(String s) {
        // 预处理
        String cleanedStr = s.toLowerCase().replaceAll("[^a-z0-9]", "");
        int len = cleanedStr.length();
        for (int i = 0; i < len / 2; i++) {
            char leftChar = cleanedStr.charAt(i);
            char rightChar = cleanedStr.charAt(len - 1 - i);
            if (leftChar != rightChar) {
                return false;
        }
        return true;
    }
}`;

export const missingPythonColon = `def positive(n):
    if n > 0
        return True
    return False
`;

const position = {
  startLine: 1, startColumn: 1, endLine: 1, endColumn: 2,
  startByte: 0, endByte: 1,
};

export const missingTokenIssue: SyntaxIssue = {
  id: 'syntax-1', kind: 'missing-token', expected: '}', text: '', ...position,
};

/** Small API stubs for client tests; real grammar recovery is tested in Python. */
export const analysisStub = (
  language: SupportedLanguage = 'java',
  recovered = false,
): CodeAnalysis => ({
  analysisVersion: 1,
  language,
  parser: 'tree-sitter',
  parseStatus: recovered ? 'recovered' : 'clean',
  source: { byteCount: 100, lineCount: 5 },
  functions: [{ name: 'f', construct: language === 'java' ? 'method_declaration' : 'function_definition', ...position }],
  facts: [
    { anchor: 'c1', kind: 'condition', construct: 'if', text: 'n > 0', parentAnchor: null, branch: 'sequence', function: 'f', flowchartRequired: true, ...position },
    { anchor: 't1', kind: 'terminal', construct: 'return', text: 'return 1', parentAnchor: 'c1', branch: 'true', function: 'f', flowchartRequired: true, ...position },
    { anchor: 't2', kind: 'terminal', construct: 'return', text: 'return 0', parentAnchor: null, branch: 'sequence', function: 'f', flowchartRequired: true, ...position },
  ],
  syntaxIssues: recovered ? [{ ...missingTokenIssue }] : [],
  factsTruncated: false,
});

export const sampleGraph = (anchored = false): FlowchartData => {
  const graph: FlowchartData = {
    student: {
      nodes: [
        { id: '1', kind: 'start', data: { label: 'START' } },
        { id: '2', kind: 'condition', data: { label: 'n > 0' } },
        { id: '3', kind: 'terminal', data: { label: 'return 1' } },
        { id: '4', kind: 'terminal', data: { label: 'return 0' } },
      ],
      edges: [
        { id: 'e1-2', source: '1', target: '2' },
        { id: 'e2-3', source: '2', target: '3', label: 'true' },
        { id: 'e2-4', source: '2', target: '4', label: 'false' },
      ],
    },
    llm: { nodes: [], edges: [] },
  };
  graph.llm = structuredClone(graph.student);
  if (anchored) {
    ['c1', 't1', 't2'].forEach((anchor, index) => {
      graph.student.nodes[index + 1].sourceAnchors = [anchor];
    });
  }
  return graph;
};
