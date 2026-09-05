import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, test } from 'node:test';
import {
  describeSettings,
  toModelConfig,
  verifySettings,
  loadRememberedPassword,
  rememberPassword,
  forgetPassword,
  type ModelSettings,
} from '../src/lib/modelSettings.ts';

const originalFetch = globalThis.fetch;

/** A minimal localStorage, since these tests run in Node rather than a browser. */
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

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as { window?: unknown }).window;
});

test('research settings travel as a password, never as a provider', () => {
  const settings: ModelSettings = { mode: 'research', password: 'study-secret' };
  assert.deepEqual(toModelConfig(settings), { password: 'study-secret' });
});

test('an omitted base URL is left out rather than sent empty', () => {
  const config = toModelConfig({
    mode: 'byok', provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x',
  });
  assert.deepEqual(config, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x' });
  assert.ok(!('baseUrl' in config));
});

test('a base URL is forwarded when the student supplied one', () => {
  assert.deepEqual(
    toModelConfig({
      mode: 'byok', provider: 'deepseek', model: 'deepseek-chat',
      apiKey: 'sk-x', baseUrl: 'https://proxy.example/v1',
    }),
    {
      provider: 'deepseek', model: 'deepseek-chat',
      apiKey: 'sk-x', baseUrl: 'https://proxy.example/v1',
    },
  );
});

test('the header label names the model without revealing the key', () => {
  assert.equal(describeSettings(null), 'Not configured');
  assert.equal(describeSettings({ mode: 'research', password: 'study-secret' }), 'Research mode');
  const label = describeSettings({
    mode: 'byok', provider: 'openai', model: 'gpt-4o', apiKey: 'sk-SECRET',
  });
  assert.equal(label, 'openai · gpt-4o');
  assert.ok(!label.includes('SECRET'));
});

test('only the research password is remembered between sessions', () => {
  rememberPassword('study-secret');
  assert.equal(loadRememberedPassword(), 'study-secret');
  forgetPassword();
  assert.equal(loadRememberedPassword(), null);
});

test('a browser that blocks storage does not break the app', () => {
  installStorage({
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('SecurityError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  });

  assert.equal(loadRememberedPassword(), null);
  assert.doesNotThrow(() => rememberPassword('study-secret'));
  assert.doesNotThrow(() => forgetPassword());
});

test('a student API key is never written to storage', () => {
  let written = '';
  installStorage({ setItem: (_key: string, value: string) => { written += value; } });

  // The panel saves BYOK settings by clearing any remembered password; the key
  // itself has no persistence path at all.
  forgetPassword();
  assert.equal(written, '');
});

test('verification reports the backend’s reason for refusing', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'Incorrect research password.' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );

  const result = await verifySettings({ mode: 'research', password: 'wrong' });
  assert.deepEqual(result, { ok: false, error: 'Incorrect research password.' });
});

test('verification surfaces the valid providers from a research config error', async () => {
  const error = 'Unsupported research PROVIDER: "gemini". Choose one of: anthropic, dashscope, deepseek, openai.';
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );

  const result = await verifySettings({ mode: 'research', password: 'study-password' });
  assert.deepEqual(result, { ok: false, error });
});

test('verification sends the config under modelConfig and accepts a pass', async () => {
  let sent: unknown;
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ ok: true, provider: 'openai', model: 'gpt-4o' });
  };

  const result = await verifySettings({
    mode: 'byok', provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x',
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(sent, {
    modelConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x' },
  });
});

test('an unreachable backend is reported rather than thrown at the panel', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };

  const result = await verifySettings({ mode: 'research', password: 'x' });
  assert.deepEqual(result, { ok: false, error: 'Could not reach the server.' });
});
