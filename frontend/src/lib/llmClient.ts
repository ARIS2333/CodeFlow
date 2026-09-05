/**
 * Talking to the backend and insisting on a well-formed answer.
 *
 * Two retry layers sit on top of each other, for two different failures:
 *   makeApiRequestWithRetry — the request never landed (network, 5xx)
 *   requestStructured       — the request landed but the model ignored the
 *                             output contract, so we say what was wrong and ask
 *                             again rather than rendering a broken flowchart
 */

import { API_URL } from '../config/apiConfig.ts';
import { parseLlmJson, isObject, type ValidationResult } from './llmJson.ts';
import type { ModelConfigPayload } from './modelSettings.ts';

export type ApiRequestConfig = {
  url: string;
  options: RequestInit;
};

export class ApiRequestError extends Error {
  public readonly status?: number;
  public readonly requestId?: string;

  constructor(
    message: string,
    status?: number,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.requestId = requestId;
  }
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const abortableDelay = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('The request was aborted', 'AbortError'));
    }, { once: true });
  });

const readPublicError = async (response: Response): Promise<{ message: string; requestId?: string }> => {
  try {
    const payload = await response.clone().json() as unknown;
    if (!isObject(payload)) return { message: `Request failed (${response.status})` };

    if (typeof payload.error === 'string') {
      return {
        message: payload.error,
        ...(typeof payload.requestId === 'string' ? { requestId: payload.requestId } : {}),
      };
    }

    if (typeof payload.body === 'string') {
      const body = JSON.parse(payload.body) as unknown;
      if (isObject(body) && typeof body.error === 'string') {
        return {
          message: body.error,
          ...(typeof body.requestId === 'string' ? { requestId: body.requestId } : {}),
        };
      }
    }
  } catch {
    // A proxy may return HTML or an empty body. The status remains useful.
  }
  return { message: `Request failed (${response.status})` };
};

const retryDelay = (response: Response | undefined, attempt: number, baseDelay: number): number => {
  const retryAfter = response?.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  return baseDelay === 0 ? 0 : baseDelay * 2 ** attempt + Math.random() * 500;
};

export const makeApiRequestWithRetry = async (
  requestConfig: ApiRequestConfig,
  maxRetries: number = 2,
  baseDelay: number = 1000,
  timeoutMs: number = 130_000,
): Promise<Response> => {
  let lastError: Error | null = null;
  const timeoutController = new AbortController();
  const externalSignal = requestConfig.options.signal;
  const onExternalAbort = () => timeoutController.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  const timeout = setTimeout(
    () => timeoutController.abort(new DOMException('The request timed out', 'TimeoutError')),
    timeoutMs,
  );

  try {
    externalSignal?.throwIfAborted();
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      timeoutController.signal.throwIfAborted();
      let response: Response | undefined;
      try {
        response = await fetch(requestConfig.url, {
          ...requestConfig.options,
          signal: timeoutController.signal,
        });

        if (response.ok) return response;

        const publicError = await readPublicError(response);
        lastError = new ApiRequestError(publicError.message, response.status, publicError.requestId);
        if (!RETRYABLE_STATUSES.has(response.status)) throw lastError;
      } catch (error: unknown) {
        timeoutController.signal.throwIfAborted();
        lastError = error instanceof Error ? error : new Error(String(error));
        if (error instanceof ApiRequestError && !RETRYABLE_STATUSES.has(error.status ?? 0)) {
          throw error;
        }
      }

      if (attempt < maxRetries) {
        await abortableDelay(retryDelay(response, attempt, baseDelay), timeoutController.signal);
      }
    }
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }

  throw lastError || new Error('Max retries exceeded with no response');
};

/** Pull the model's text out of the backend's Lambda-shaped envelope. */
const unwrapEnvelope = (envelope: unknown): { ok: true; text: unknown } | { ok: false; error: string } => {
  if (!isObject(envelope)) {
    return { ok: false, error: 'the backend response was not an object' };
  }

  if (typeof envelope.body !== 'string') {
    return { ok: false, error: 'the backend response has no "body" string' };
  }

  let body: unknown;
  try {
    body = JSON.parse(envelope.body);
  } catch {
    return { ok: false, error: 'the backend "body" was not valid JSON' };
  }

  if (!isObject(body)) {
    return { ok: false, error: 'the backend "body" was not an object' };
  }

  if (typeof body.error === 'string') {
    const details = typeof body.details === 'string' ? `: ${body.details}` : '';
    return { ok: false, error: `${body.error}${details}` };
  }

  if (body.response === undefined) {
    return { ok: false, error: 'the backend "body" has no "response" field' };
  }

  return { ok: true, text: body.response };
};

/** What we send back to the model after rejecting an answer. */
const buildRetryNotice = (problems: string[]): string =>
  [
    '',
    '---',
    'IMPORTANT: your previous reply was REJECTED because it did not follow the',
    'required output format. Problems found:',
    ...problems.map((problem) => `- ${problem}`),
    '',
    'Send the corrected answer as a single raw JSON object matching the format',
    'described in the system prompt. No markdown code fences, no commentary.',
  ].join('\n');

export interface StructuredRequestOptions<T> {
  /** System prompt describing the required output format. */
  systemPrompt: string;
  /** The user message, before any retry notice is appended. */
  message: string;
  /** Contract check for the parsed reply. */
  validate: (input: unknown) => ValidationResult<T>;
  /** Name used in console output and error messages, e.g. "flowchart". */
  label: string;
  /** How many times to ask the model in total. */
  maxAttempts?: number;
  /** Cancels all transport and output-format attempts for this operation. */
  signal?: AbortSignal;
  /** Overall deadline across all output-format attempts. */
  timeoutMs?: number;
  /**
   * Which model to call and with whose credentials. Required: the backend
   * rejects an LLM request that carries no credentials, so that the study's
   * quota is never spent by default.
   */
  modelConfig: ModelConfigPayload;
}

/**
 * Ask the model for a JSON answer and only return once it satisfies `validate`.
 * Cosmetic problems (code fences, stray prose, trailing commas) are repaired
 * here and merely logged; contract violations cost a fresh attempt, with the
 * specific complaints handed back to the model.
 */
export const requestStructured = async <T>({
  systemPrompt,
  message,
  validate,
  label,
  maxAttempts = 3,
  signal,
  timeoutMs = 150_000,
  modelConfig,
}: StructuredRequestOptions<T>): Promise<T> => {
  let problems: string[] = [];
  const operationController = new AbortController();
  const onAbort = () => operationController.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(
    () => operationController.abort(new DOMException(`${label} timed out`, 'TimeoutError')),
    timeoutMs,
  );

  try {
    signal?.throwIfAborted();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      operationController.signal.throwIfAborted();
      const userMessage =
        attempt === 1 ? message : `${message}\n${buildRetryNotice(problems)}`;

      const response = await makeApiRequestWithRetry({
        url: API_URL,
        options: {
          signal: operationController.signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            message: userMessage,
            system_message: systemPrompt,
            modelConfig,
          }),
        },
      });

      const envelope = await response.json();
      const unwrapped = unwrapEnvelope(envelope);

      if (!unwrapped.ok) {
        throw new Error(`${label}: ${unwrapped.error}`);
      }

      const parsed = parseLlmJson(unwrapped.text);

      if (!parsed.ok) {
        problems = [parsed.error];
        console.warn(
          `[${label}] unusable reply on attempt ${attempt}/${maxAttempts}:`,
          parsed.error
        );
        continue;
      }

      const result = validate(parsed.value);

      if (result.ok) {
        const repairs = [...parsed.repairs, ...result.repairs];
        if (repairs.length) {
          console.info(
            `[${label}] accepted the reply after ${repairs.length} repair(s):`,
            repairs
          );
        }
        return result.value;
      }

      problems = result.errors;
      console.warn(
        `[${label}] rejected the reply on attempt ${attempt}/${maxAttempts}:`,
        result.errors
      );
    }

    throw new Error(
      `${label}: the model returned an invalid format ${maxAttempts} times in a row. ` +
        `Last problems — ${problems.join('; ')}`
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
};
