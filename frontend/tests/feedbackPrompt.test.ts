import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  feedbackSystemPromptFor,
  systemPrompt_GenerateCppFeedback,
  systemPrompt_GenerateJavaFeedback,
  systemPrompt_GeneratePythonFeedback,
} from '../src/config/systemPrompt_GenerateFeedback.ts';
import {
  validateCodeEvaluation,
  validateCodeEvaluationForAnalysis,
} from '../src/lib/llmSchemas.ts';
import { analysisStub } from './flowchartFixtures.ts';

test('Java feedback uses Java compilation rules and accepts method-only exercises', () => {
  const prompt = feedbackSystemPromptFor('java');
  assert.equal(prompt, systemPrompt_GenerateJavaFeedback);
  assert.match(prompt, /"❌ Compile Error"/);
  assert.match(prompt, /placed unchanged inside a\s+valid class/);
  assert.match(prompt, /static type-checking failure/);
  assert.match(prompt, /MANDATORY JAVA COMPILATION GATE/);
  assert.match(prompt, /body can complete normally/);
  assert.match(prompt, /nested-if false path reaching the method\s+end/);
  assert.match(prompt, /outsideMode = true/);
  assert.match(prompt, /Runtime Error: <exception class>/);
});

test('Python feedback separates syntax errors from runtime exceptions', () => {
  const prompt = feedbackSystemPromptFor('python');
  assert.equal(prompt, systemPrompt_GeneratePythonFeedback);
  assert.match(prompt, /"❌ Syntax Error"/);
  assert.match(prompt, /Runtime Error: <exception type>/);
  assert.match(prompt, /reaching the end without return produces None/);
  assert.match(prompt, /identifiers are case-sensitive/);
  assert.match(prompt, /def f\(outsideMode\).*OutsideMode raises NameError/s);
  assert.match(prompt, /first condition executed.*every call fails/s);
  assert.match(prompt, /UnboundLocalError only for paths that reach it/);
  assert.match(prompt, /Once a case raises an exception, it has no return value/);
  assert.match(prompt, /syntaxIssues is empty.*Do not report "❌ Syntax Error"/s);
  assert.doesNotMatch(prompt, /use exactly\s+"❌ Compile Error"/);
});

test('C++ feedback uses compilation and undefined-behavior rules', () => {
  const prompt = feedbackSystemPromptFor('cpp');
  assert.equal(prompt, systemPrompt_GenerateCppFeedback);
  assert.match(prompt, /C\+\+-SPECIFIC RULES/);
  assert.match(prompt, /"❌ Compile Error"/);
  assert.match(prompt, /valid translation unit/);
  assert.match(prompt, /compilerStatus records the real C\+\+ compiler gate/);
  assert.match(prompt, /"passed".*never report a Compile Error/s);
  assert.match(prompt, /Runtime Error: Undefined Behavior/);
  assert.match(prompt, /value versus\s+reference parameters/);
});

test('both prompts derive expected values independently and preserve the JSON contract', () => {
  for (const prompt of [
    systemPrompt_GenerateJavaFeedback,
    systemPrompt_GeneratePythonFeedback,
    systemPrompt_GenerateCppFeedback,
  ]) {
    assert.match(prompt, /from the practice before considering/);
    assert.match(prompt, /at least five distinct valid test cases/);
    assert.match(prompt, /"IsCorrect"/);
    assert.match(prompt, /"TestResults"/);
    assert.match(prompt, /Return JSON only/);
  }
});

test('a blocking language error cannot be mixed with simulated outputs', () => {
  const result = validateCodeEvaluation({
    IsCorrect: false,
    TestResults: [
      { input: 'in1To10(5, false)', expected: 'true', yourOutput: '❌ Compile Error' },
      { input: 'in1To10(11, false)', expected: 'false', yourOutput: '✅ false' },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(' '), /whole-submission failure/);
  }
});

test('a compilation failure is accepted only when every case is blocked', () => {
  const result = validateCodeEvaluation({
    IsCorrect: false,
    TestResults: [
      { input: 'in1To10(5, false)', expected: 'true', yourOutput: '❌ Compile Error' },
      { input: 'in1To10(11, false)', expected: 'false', yourOutput: '❌ Compile Error' },
    ],
  });

  assert.equal(result.ok, true);
});

test('source-backed Java compile issues override invented runtime outputs', () => {
  const analysis = analysisStub('java');
  analysis.compileIssues = [{
    id: 'compile-1',
    kind: 'missing-return',
    text: 'Non-void method can complete without returning a value.',
    expected: 'return',
    startLine: 1,
    startColumn: 1,
    endLine: 10,
    endColumn: 2,
    startByte: 0,
    endByte: 100,
  }];
  const result = validateCodeEvaluationForAnalysis({
    IsCorrect: false,
    TestResults: [
      { input: 'in1To10(5, false)', expected: 'true', yourOutput: '✅ true' },
      { input: 'in1To10(11, false)', expected: 'false', yourOutput: '❌ true' },
    ],
  }, analysis);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.IsCorrect, false);
    assert.deepEqual(
      result.value.TestResults.map(({ yourOutput }) => yourOutput),
      ['❌ Compile Error', '❌ Compile Error'],
    );
  }
});

test('clean Python analysis rejects a model-invented syntax error', () => {
  const analysis = analysisStub('python');
  const result = validateCodeEvaluationForAnalysis({
    IsCorrect: false,
    TestResults: [
      { input: 'in1To10(5, False)', expected: 'True', yourOutput: '❌ Syntax Error' },
      { input: 'in1To10(11, False)', expected: 'False', yourOutput: '❌ Syntax Error' },
    ],
  }, analysis);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(' '), /passed syntax analysis/);
  }
});

test('source-backed Python syntax issues still block every test case', () => {
  const analysis = analysisStub('python');
  analysis.syntaxIssues = [{
    id: 'syntax-1',
    kind: 'python-syntax-error',
    text: "'return' outside function",
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 12,
    startByte: 0,
    endByte: 11,
  }];
  const result = validateCodeEvaluationForAnalysis({
    IsCorrect: true,
    TestResults: [
      { input: 'f()', expected: 'True', yourOutput: '✅ True' },
      { input: 'f()', expected: 'False', yourOutput: '❌ True' },
    ],
  }, analysis);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.IsCorrect, false);
    assert.deepEqual(
      result.value.TestResults.map(({ yourOutput }) => yourOutput),
      ['❌ Syntax Error', '❌ Syntax Error'],
    );
  }
});

test('a passed real C++ compile rejects a model-invented compile error', () => {
  const analysis = analysisStub('cpp');
  analysis.compilerStatus = 'passed';
  const result = validateCodeEvaluationForAnalysis({
    IsCorrect: false,
    TestResults: [
      { input: 'findMode({5})', expected: '5', yourOutput: '❌ Compile Error' },
      { input: 'findMode({1, 2})', expected: '1', yourOutput: '❌ Compile Error' },
    ],
  }, analysis);

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(' '), /passed the real compiler check/);
});

test('a failed real C++ compile overrides simulated test outputs', () => {
  const analysis = analysisStub('cpp');
  analysis.compilerStatus = 'failed';
  const result = validateCodeEvaluationForAnalysis({
    IsCorrect: true,
    TestResults: [
      { input: 'f(1)', expected: '1', yourOutput: '✅ 1' },
      { input: 'f(2)', expected: '2', yourOutput: '✅ 2' },
    ],
  }, analysis);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.IsCorrect, false);
    assert.deepEqual(
      result.value.TestResults.map(({ yourOutput }) => yourOutput),
      ['❌ Compile Error', '❌ Compile Error'],
    );
  }
});
