import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { JsonObjectStream, type JsonStreamValue } from '../src/lib/jsonObjectStream.ts';
import { sampleGraph } from './flowchartFixtures.ts';

const graph = sampleGraph();
graph.student.nodes[1].data.label = 'if (text == "} [ \\" 中文 😀")';
const object = {
  missingSymbols: [{ symbol: '}', explanation: 'String contains "quotes" and \\ escapes' }, { symbol: ';' }],
  ...graph,
};
const json = JSON.stringify(object);

test('every possible two-part split yields the same complete fields and suggestions', () => {
  for (let split = 0; split <= json.length; split++) {
    const events: JsonStreamValue[] = [];
    const parser = new JsonObjectStream((event) => events.push(event));
    parser.push(json.slice(0, split));
    parser.push(json.slice(split));
    assert.deepEqual({ ...parser.finish() }, object);
    assert.deepEqual(events.filter((event) => event.type === 'item').map((event) => event.value), object.missingSymbols);
    assert.deepEqual(events.filter((event) => event.type === 'field').map((event) => event.key), ['missingSymbols', 'student', 'llm']);
  }
});

test('one-character chunks support escaped quotes, backslashes, braces, and Unicode', () => {
  const parser = new JsonObjectStream(() => {});
  for (const char of json) parser.push(char);
  assert.deepEqual({ ...parser.finish() }, object);
});

test('one suggestion is emitted before its array and either graph are complete', () => {
  const events: JsonStreamValue[] = [];
  const parser = new JsonObjectStream((event) => events.push(event));
  parser.push('{"missingSymbols":[' + JSON.stringify(object.missingSymbols[0]));
  assert.deepEqual(events, [{ type: 'item', key: 'missingSymbols', value: object.missingSymbols[0] }]);
  parser.push('],"student":' + JSON.stringify(graph.student));
  assert.equal(events.at(-1)?.key, 'student');
  assert.throws(() => parser.finish(), /incomplete JSON/);
  parser.push(',"llm":' + JSON.stringify(graph.llm) + '}');
  assert.equal(events.at(-1)?.key, 'llm');
  assert.ok(parser.finish());
});

test('field order is not assumed and completed values are not emitted again', () => {
  const events: JsonStreamValue[] = [];
  const parser = new JsonObjectStream((event) => events.push(event));
  for (const part of ['{"llm":', JSON.stringify(graph.llm), ', "student":', JSON.stringify(graph.student), ', "missingSymbols":[]', '}']) parser.push(part);
  parser.finish();
  assert.deepEqual(events.map((event) => event.key), ['llm', 'student', 'missingSymbols']);
});

test('malformed optional entries are complete JSON values, not parser errors', () => {
  const events: JsonStreamValue[] = [];
  const parser = new JsonObjectStream((event) => events.push(event));
  parser.push('{"missingSymbols":[null,2,"text",[1],{}],"extra":true}');
  assert.deepEqual({ ...parser.finish() }, { missingSymbols: [null, 2, 'text', [1], {}], extra: true });
  assert.equal(events.filter((event) => event.type === 'item').length, 5);
});

test('optional markdown fences split across chunks are handled without exposing raw text', () => {
  const parser = new JsonObjectStream(() => {});
  for (const c of '\n```json\n' + json + '\n```\n') parser.push(c);
  assert.deepEqual({ ...parser.finish() }, object);
});

for (const broken of [
  '{"student":{', '{"student":{"text":"unfinished',
  '{"student":{},"student":{}}', '{"student":{},"student":null}',
  '{"student":{},}', '{"missingSymbols":[{"symbol":"}"}}',
  '{"student":{} "llm":{}}', '{"student":{}}junk',
  '{"missingSymbols":[{},,{}]}',
]) {
  test(`rejects incomplete or ambiguous JSON: ${broken}`, () => {
    const parser = new JsonObjectStream(() => {});
    assert.throws(() => { parser.push(broken); parser.finish(); });
  });
}
