/**
 * Talking to the backend and insisting on a well-formed answer.
 *
 * Two retry layers sit on top of each other, for two different failures:
 *   makeApiRequestWithRetry — the request never landed (network, 5xx)
 *   requestStructured       — the request landed but the model ignored the
 *                             output contract, so we say what was wrong and ask
 *                             again rather than rendering a broken flowchart
 */

import { API_URL } from '../config/apiConfig';
import { parseLlmJson, isObject, type ValidationResult } from './llmJson';

export type ApiRequestConfig = {
  url: string;
  options: RequestInit;
};

export const makeApiRequestWithRetry = async (
  requestConfig: ApiRequestConfig,
  maxRetries: number = 3,
  baseDelay: number = 1000 // 1 second
): Promise<Response> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(requestConfig.url, requestConfig.options);

      if (response.ok) {
        return response;
      }

      throw new Error(`API request failed with status ${response.status}`);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`API request failed (attempt ${attempt + 1}/${maxRetries + 1}):`, lastError.message);

      if (attempt < maxRetries) {
        // Exponential backoff with jitter.
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
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
}: StructuredRequestOptions<T>): Promise<T> => {
  let problems: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userMessage =
      attempt === 1 ? message : `${message}\n${buildRetryNotice(problems)}`;

    const response = await makeApiRequestWithRetry({
      url: API_URL,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          system_message: systemPrompt,
        }),
      },
    });

    const envelope = await response.json();
    const unwrapped = unwrapEnvelope(envelope);

    if (!unwrapped.ok) {
      // A backend-side failure, not a formatting one: retrying the prompt will
      // not help, so surface it straight away.
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
};
