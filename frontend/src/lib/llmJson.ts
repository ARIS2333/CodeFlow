/**
 * Turning a raw LLM reply into parsed JSON.
 *
 * The model is asked for a bare JSON object, but in practice it also wraps the
 * answer in a markdown fence, prefixes it with a bare language word, adds a
 * sentence of prose, or leaves a trailing comma. Those are cosmetic: we repair
 * them here and record what was repaired. Anything we cannot repair is reported
 * as an error so the caller can ask the model to try again.
 */

export type ValidationResult<T> =
  | { ok: true; value: T; repairs: string[] }
  | { ok: false; errors: string[] };

export type ParseResult =
  | { ok: true; value: unknown; repairs: string[] }
  | { ok: false; error: string };

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Index just past the bracket that closes the one opening at `start`, or -1 if
 * it never closes. Brackets inside string literals are ignored, so a label like
 * "if (a) { b }" cannot throw the scan off.
 */
const findMatchingBracket = (text: string, start: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
};

/** Drop commas that sit right before a closing bracket, ignoring string bodies. */
const stripTrailingCommas = (text: string): string => {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ',') {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === '}' || text[next] === ']') continue;
    }

    out += char;
  }

  return out;
};

/**
 * Parse a raw model reply into JSON, repairing the cosmetic problems listed
 * above. Repairs are applied in increasing order of intrusiveness and each one
 * is only reached if the plainer attempts failed.
 */
export const parseLlmJson = (raw: unknown): ParseResult => {
  if (typeof raw !== 'string') {
    return { ok: false, error: `expected a string reply but received ${typeof raw}` };
  }

  const repairs: string[] = [];
  let text = raw.trim();

  if (!text) return { ok: false, error: 'the model returned an empty reply' };

  // ```json ... ``` — or an unterminated opening fence.
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z0-9]*[ \t]*\r?\n?/, '');
    if (text.endsWith('```')) text = text.slice(0, -3);
    text = text.trim();
    repairs.push('stripped markdown code fence');
  }

  // A bare language tag on its own first line ("json\n{ ... }").
  const bareTag = text.match(/^(json|javascript|js)[ \t]*\r?\n/i);
  if (bareTag) {
    text = text.slice(bareTag[0].length).trim();
    repairs.push(`stripped leading "${bareTag[1]}" tag`);
  }

  const attempt = (candidate: string): unknown | undefined => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  let value = attempt(text);

  // Prose before or after the object ("Here is the JSON: { ... } Hope this helps").
  if (value === undefined) {
    const start = text.search(/[{[]/);
    if (start !== -1) {
      const end = findMatchingBracket(text, start);
      if (end !== -1) {
        const extracted = text.slice(start, end);
        const parsed = attempt(extracted);
        if (parsed !== undefined) {
          text = extracted;
          value = parsed;
          repairs.push('extracted the JSON object out of surrounding prose');
        }
      }
    }
  }

  // Trailing commas before a closing bracket.
  if (value === undefined) {
    const cleaned = stripTrailingCommas(text);
    if (cleaned !== text) {
      const parsed = attempt(cleaned);
      if (parsed !== undefined) {
        value = parsed;
        repairs.push('removed trailing commas');
      }
    }
  }

  if (value === undefined) {
    // Report the real parser message; it tells the model where it went wrong.
    try {
      JSON.parse(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `reply is not valid JSON (${detail})` };
    }
  }

  return { ok: true, value, repairs };
};
