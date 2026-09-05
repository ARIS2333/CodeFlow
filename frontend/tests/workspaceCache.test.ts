import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, test } from 'node:test';
import {
  clearWorkspaceCache,
  loadWorkspaceCache,
  updateWorkspaceCache,
} from '../src/lib/workspaceCache.ts';

const installStorage = (impl?: Partial<Storage>) => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      ...impl,
    },
  };
};

beforeEach(() => installStorage());
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

test('editor, problem, and generated results merge into one refresh snapshot', () => {
  updateWorkspaceCache({ code: 'return a + b;', language: 'java' });
  updateWorkspaceCache({
    problem: 'Add two numbers',
    problemDetails: {
      title: 'Addition',
      description: 'Add the inputs.',
      examples: [{ input: '1 2', output: '3' }],
      constraints: [],
    },
  });
  updateWorkspaceCache({
    evaluationState: {
      status: 'success',
      data: { IsCorrect: true, TestResults: [] },
    },
  });

  const restored = loadWorkspaceCache();
  assert.equal(restored?.code, 'return a + b;');
  assert.equal(restored?.problemDetails?.title, 'Addition');
  assert.equal(restored?.evaluationState?.status, 'success');
});

test('a refresh never restores an interrupted request as permanently loading', () => {
  updateWorkspaceCache({
    evaluationState: { status: 'loading' },
    flowchartState: { status: 'loading' },
    traceState: {
      status: 'loading',
      request: {
        practice: { title: 'T', description: 'D', examples: [], constraints: [] },
        language: 'python',
        code: 'pass',
        graphs: { student: { nodes: [], edges: [] }, llm: { nodes: [], edges: [] } },
        testCase: { input: '1' },
      },
    },
  });

  const restored = loadWorkspaceCache();
  assert.equal(restored?.evaluationState?.status, 'idle');
  assert.equal(restored?.flowchartState?.status, 'idle');
  assert.equal(restored?.traceState?.status, 'idle');
});

test('blocked or malformed browser storage is safely ignored', () => {
  installStorage({ getItem: () => '{not json' });
  assert.equal(loadWorkspaceCache(), null);

  installStorage({
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('SecurityError'); },
  });
  assert.equal(loadWorkspaceCache(), null);
  assert.doesNotThrow(() => updateWorkspaceCache({ code: 'still usable' }));
});

test('clear removes the workspace without touching unrelated browser data', () => {
  window.localStorage.setItem('codeflow.researchPassword', 'study-secret');
  updateWorkspaceCache({ code: 'student work' });

  clearWorkspaceCache();

  assert.equal(loadWorkspaceCache(), null);
  assert.equal(window.localStorage.getItem('codeflow.researchPassword'), 'study-secret');
});
