import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  feedbackSystemPromptFor,
  systemPrompt_GenerateJavaFeedback,
  systemPrompt_GeneratePythonFeedback,
} from '../src/config/systemPrompt_GenerateFeedback.ts';

test('Java feedback uses Java compilation rules and accepts method-only exercises', () => {
  const prompt = feedbackSystemPromptFor('java');
  assert.equal(prompt, systemPrompt_GenerateJavaFeedback);
  assert.match(prompt, /"❌ Compile Error"/);
  assert.match(prompt, /placed unchanged inside a\s+valid class/);
  assert.match(prompt, /static type-checking failure/);
  assert.match(prompt, /Runtime Error: <exception class>/);
});

test('Python feedback separates syntax errors from runtime exceptions', () => {
  const prompt = feedbackSystemPromptFor('python');
  assert.equal(prompt, systemPrompt_GeneratePythonFeedback);
  assert.match(prompt, /"❌ Syntax Error"/);
  assert.match(prompt, /Runtime Error: <exception type>/);
  assert.match(prompt, /reaching the end without return produces None/);
  assert.doesNotMatch(prompt, /use exactly\s+"❌ Compile Error"/);
});

test('both prompts derive expected values independently and preserve the JSON contract', () => {
  for (const prompt of [systemPrompt_GenerateJavaFeedback, systemPrompt_GeneratePythonFeedback]) {
    assert.match(prompt, /from the practice before considering/);
    assert.match(prompt, /at least five distinct valid test cases/);
    assert.match(prompt, /"IsCorrect"/);
    assert.match(prompt, /"TestResults"/);
    assert.match(prompt, /Return JSON only/);
  }
});
