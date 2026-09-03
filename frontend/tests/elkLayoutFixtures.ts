import type { DiagramNode, DiagramEdge } from '../src/lib/flowchartLayout.ts';

const node = (id: string, kind: DiagramNode['data']['kind'], label: string, width = 180): DiagramNode => ({
  id, data: { kind, label }, position: { x: 0, y: 0 }, measured: { width, height: 40 },
});
const edge = (source: string, target: string, label?: string): DiagramEdge => ({
  id: `${source}-${target}`, source, target, label,
});

// Exactly the screenshot's topology: intentionally do not add for initialization
// or increment nodes. This is a layout regression, not a code-generation change.
export const palindromeGraph = () => ({
  nodes: [
    node('start', 'start', 'START', 90),
    node('clean', 'process', 'String cleanedStr = s.toLowerCase().replaceAll("[^a-z0-9]", "");', 460),
    node('len', 'process', 'int len = cleanedStr.length();', 250),
    node('loop', 'condition', 'i < len / 2', 110),
    node('left', 'process', 'char leftChar = cleanedStr.charAt(i);', 310),
    node('right', 'process', 'char rightChar = cleanedStr.charAt(len - 1 - i);', 390),
    node('compare', 'condition', 'leftChar != rightChar', 200),
    node('yes', 'terminal', 'return true;', 120),
    node('no', 'terminal', 'return false;', 120),
  ],
  edges: [edge('start', 'clean'), edge('clean', 'len'), edge('len', 'loop'),
    edge('loop', 'left', 'true'), edge('left', 'right'), edge('right', 'compare'),
    edge('compare', 'loop', 'false'), edge('compare', 'no', 'true'), edge('loop', 'yes', 'false')],
});

export const nestedGraph = () => ({
  nodes: [node('start', 'start', 'START'), node('outer', 'condition', 'while (i < rows)'),
    node('inner', 'condition', 'while (j < columns)'), node('body', 'process', 'visit(i, j); j++;'),
    node('update', 'process', 'i++;'), node('end', 'terminal', 'return result;')],
  edges: [edge('start', 'outer'), edge('outer', 'inner', 'true'), edge('inner', 'body', 'true'),
    edge('body', 'inner'), edge('inner', 'update', 'false'), edge('update', 'outer'), edge('outer', 'end', 'false')],
});

export const branchGraph = () => ({
  nodes: [node('start', 'start', 'START'), node('test', 'condition', 'condition'),
    node('a', 'process', 'step A'), node('b', 'process', 'step B'), node('join', 'process', 'shared step'),
    node('end', 'end', 'END')],
  edges: [edge('start', 'test'), edge('test', 'a', 'true'), edge('test', 'b', 'false'),
    edge('a', 'join'), edge('b', 'join'), edge('join', 'end')],
});

export const jumpGraph = () => ({
  nodes: [node('start', 'start', 'START'), node('loop', 'condition', 'loop condition'),
    node('test1', 'condition', 'skip?'), node('continue', 'process', 'continue'),
    node('test2', 'condition', 'stop?'), node('break', 'process', 'break'), node('body', 'process', 'body'),
    node('update', 'process', 'update'), node('end', 'end', 'END')],
  edges: [edge('start', 'loop'), edge('loop', 'test1', 'true'), edge('loop', 'end', 'false'),
    edge('test1', 'continue', 'true'), edge('continue', 'update'), edge('test1', 'test2', 'false'),
    edge('test2', 'break', 'true'), edge('break', 'end'), edge('test2', 'body', 'false'),
    edge('body', 'update'), edge('update', 'loop')],
});
