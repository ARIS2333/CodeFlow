import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignSqlSteps } from '../src/lib/sqlAlignment.ts';
const steps = (...phases: string[]) => phases.map(phase => ({ phase }));
test('missing WHERE does not pair grouping with filtering', () => {
  const result = alignSqlSteps(steps('from', 'select', 'having'), steps('from', 'where', 'select', 'having'));
  assert.deepEqual(result.map(row => [row.left?.phase, row.right?.phase]), [
    ['from', 'from'], [undefined, 'where'], ['select', 'select'], ['having', 'having'],
  ]);
});
test('different nested query scopes stay unpaired and preserve execution order', () => {
  const left = steps('query/derived/select', 'query/from', 'query/select');
  const right = steps('query/from', 'query/select');
  const result = alignSqlSteps(left, right);
  assert.equal(result[0].right, undefined);
  assert.deepEqual(result.flatMap(row => row.left ? [row.left] : []), left);
  assert.deepEqual(result.flatMap(row => row.right ? [row.right] : []), right);
});
test('alignment works while only the student execution is available', () => {
  assert.equal(alignSqlSteps(steps('from', 'select'), []).length, 2);
  assert.deepEqual(alignSqlSteps([], []), []);
});
