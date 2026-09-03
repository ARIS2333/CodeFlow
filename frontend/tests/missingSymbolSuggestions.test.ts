import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readMissingSymbolSuggestions } from '../src/lib/missingSymbolSuggestions.ts';

const code = 'if (left != right) {\n    return false;\nnext();';
const suggestion = {
  symbol: '}', line: 2, anchor: 'return false;', placement: 'after',
  explanation: 'The inner if block may need to close before the next statement.',
};

test('a missing brace references an existing source line without modifying it', () => {
  const result = readMissingSymbolSuggestions({ missingSymbols: [suggestion] }, code);
  assert.deepEqual(result, [{
    symbol: '}', explanation: suggestion.explanation,
    location: { line: 2, anchor: 'return false;', placement: 'after', sourceLine: '    return false;' },
  }]);
  assert.equal(code, 'if (left != right) {\n    return false;\nnext();');
});

test('before anchors can identify a missing parenthesis inside a line', () => {
  const result = readMissingSymbolSuggestions({ missingSymbols: [{
    ...suggestion, symbol: ')', line: 1, anchor: '{', placement: 'before',
  }] }, 'if (n > 0 { return true; }');
  assert.deepEqual(result?.[0].location, {
    line: 1, anchor: '{', placement: 'before', sourceLine: 'if (n > 0 { return true; }',
  });
});

test('locations count blank lines and CRLF correctly and preserve Unicode source text', () => {
  const source = '// 中文 😀\r\n\r\n    if 数值 > 0\r\n        return True\r\n';
  const result = readMissingSymbolSuggestions({ missingSymbols: [{
    ...suggestion, symbol: ':', line: 3, anchor: 'if 数值 > 0',
  }] }, source);
  assert.deepEqual(result?.[0].location, {
    line: 3, anchor: 'if 数值 > 0', placement: 'after', sourceLine: '    if 数值 > 0',
  });
});

for (const [name, location] of [
  ['out-of-range line', { line: 99 }],
  ['zero-based line', { line: 0 }],
  ['fractional line', { line: 1.5 }],
  ['string line', { line: '2' }],
  ['invented anchor', { anchor: 'return true;' }],
  ['anchor from a different line', { line: 1 }],
  ['empty anchor', { anchor: '' }],
  ['whitespace anchor', { anchor: ' ' }],
  ['ambiguous repeated anchor', { line: 3, anchor: ';' }],
  ['unknown placement', { placement: 'somewhere' }],
  ['explicitly unknown location', { line: null, anchor: null, placement: null }],
] as const) {
  test(`${name} produces an unlocated suggestion, never a fabricated location`, () => {
    const result = readMissingSymbolSuggestions({ missingSymbols: [{ ...suggestion, ...location }] }, `${code};`);
    assert.deepEqual(result, [{ symbol: '}', explanation: suggestion.explanation }]);
  });
}

test('malformed optional feedback is ignored rather than treated as an empty report', () => {
  for (const input of [null, {}, { missingSymbols: 'missing }' },
    { missingSymbols: [null, {}, { ...suggestion, symbol: '=='}] },
    { missingSymbols: [{ ...suggestion, explanation: 'x'.repeat(601) }] },
  ]) {
    assert.equal(readMissingSymbolSuggestions(input, code), undefined);
  }
  assert.deepEqual(readMissingSymbolSuggestions({ missingSymbols: [] }, code), []);
});

test('only syntax punctuation is accepted, not arbitrary code or logic replacements', () => {
  for (const symbol of ['==', '=', 'return true;', '<script>', 'else', '']) {
    assert.equal(readMissingSymbolSuggestions({ missingSymbols: [{ ...suggestion, symbol }] }, code), undefined);
  }
  assert.equal(readMissingSymbolSuggestions({ missingSymbols: [{ ...suggestion, symbol: '"""' }] }, code)?.[0].symbol, '"""');
});

test('duplicate reports are removed and displayed suggestions are bounded', () => {
  assert.equal(readMissingSymbolSuggestions({ missingSymbols: [suggestion, suggestion] }, code)?.length, 1);
  const many = Array.from({ length: 40 }, (_, index) => ({ ...suggestion, explanation: `Possible missing brace ${index}` }));
  assert.equal(readMissingSymbolSuggestions({ missingSymbols: many }, code)?.length, 8);
});
