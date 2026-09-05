/**
 * Which model the app may call, and with whose credentials.
 *
 * Two shapes, matching the two ways a student can be authorised:
 *   research — the study password; the server pays, and the password is
 *              checked on the server, never here
 *   byok     — the student's own provider, model, and key
 *
 * The student's API key is deliberately never persisted. It lives in React
 * state for the lifetime of the tab and is gone on reload, so a shared or
 * lab machine does not keep it. The research password is a study-wide secret
 * rather than a personal credential, so it is remembered for convenience.
 */

import { API_BASE_URL } from '../config/apiConfig.ts';

export type ProviderId = 'openai' | 'dashscope' | 'anthropic' | 'deepseek';

export interface ProviderOption {
  id: ProviderId;
  label: string;
  exampleModel: string;
}

export interface ProviderCatalog {
  providers: ProviderOption[];
  researchModeAvailable: boolean;
}

export type ModelSettings =
  | { mode: 'research'; password: string }
  | { mode: 'byok'; provider: ProviderId; model: string; apiKey: string; baseUrl?: string };

/** The wire shape the backend expects under `modelConfig`. */
export type ModelConfigPayload =
  | { password: string }
  | { provider: ProviderId; model: string; apiKey: string; baseUrl?: string };

export const toModelConfig = (settings: ModelSettings): ModelConfigPayload =>
  settings.mode === 'research'
    ? { password: settings.password }
    : {
      provider: settings.provider,
      model: settings.model,
      apiKey: settings.apiKey,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
    };

/** A short label for the header, naming the model without exposing the key. */
export const describeSettings = (settings: ModelSettings | null): string => {
  if (!settings) return 'Not configured';
  if (settings.mode === 'research') return 'Research mode';
  return `${settings.provider} · ${settings.model}`;
};

const RESEARCH_PASSWORD_KEY = 'codeflow.researchPassword';

/**
 * Only the research password is remembered, and only because re-entering it on
 * every reload is friction for a study session. Reading it can throw in a
 * private window or when site data is blocked, so failure is not an error.
 */
export const loadRememberedPassword = (): string | null => {
  try {
    return window.localStorage.getItem(RESEARCH_PASSWORD_KEY);
  } catch {
    return null;
  }
};

export const rememberPassword = (password: string): void => {
  try {
    window.localStorage.setItem(RESEARCH_PASSWORD_KEY, password);
  } catch {
    // A remembered password is a convenience, never a requirement.
  }
};

export const forgetPassword = (): void => {
  try {
    window.localStorage.removeItem(RESEARCH_PASSWORD_KEY);
  } catch {
    // Nothing to do: the value was already unreachable.
  }
};

export const fetchProviderCatalog = async (
  signal?: AbortSignal,
): Promise<ProviderCatalog> => {
  const response = await fetch(`${API_BASE_URL}/api/providers`, { signal });
  if (!response.ok) throw new Error(`Could not load providers (${response.status})`);
  return await response.json() as ProviderCatalog;
};

/**
 * Ask the backend whether these settings are usable, before a student spends a
 * run finding out. A successful check validates the password or the shape of a
 * key — it does not prove the provider will accept the key.
 */
export const verifySettings = async (
  settings: ModelSettings,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/verify-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelConfig: toModelConfig(settings) }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { ok: false, error: 'Could not reach the server.' };
  }

  if (response.ok) return { ok: true };
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === 'string') return { ok: false, error: payload.error };
  } catch {
    // Fall through to the status-based message.
  }
  return { ok: false, error: `Check failed (${response.status})` };
};
