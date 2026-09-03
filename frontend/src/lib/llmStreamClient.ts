import { STREAM_API_URL } from '../config/apiConfig.ts';
import { isObject, type ValidationResult } from './llmJson.ts';
import { JsonObjectStream, type JsonStreamValue } from './jsonObjectStream.ts';

class StreamTransportError extends Error {}

/** Read backend NDJSON frames across arbitrary byte boundaries (including UTF-8). */
export const consumeModelStream = async (
  response: Response,
  onDelta: (text: string) => void,
): Promise<void> => {
  if (!response.ok) throw new StreamTransportError(`Model request failed (${response.status})`);
  if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) {
    throw new StreamTransportError('The backend did not return a model stream');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let done = false;
  const frame = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try { event = JSON.parse(line); } catch { throw new StreamTransportError('Invalid stream frame'); }
    if (!isObject(event)) throw new StreamTransportError('Invalid stream frame');
    if (done) throw new StreamTransportError('Unexpected data after stream completion');
    if (event.type === 'delta' && typeof event.text === 'string') onDelta(event.text);
    else if (event.type === 'done') done = true;
    else if (event.type === 'error') {
      throw new StreamTransportError(typeof event.message === 'string' ? event.message : 'Model stream failed');
    } else if (event.type !== 'ping' && event.type !== 'start') throw new StreamTransportError('Unknown stream event');
  };
  try {
    while (true) {
      const part = await reader.read();
      buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
      if (buffer.length > 2_100_000) throw new StreamTransportError('Stream frame is too large');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        frame(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (part.done || done) break;
    }
    if (buffer.trim()) frame(buffer);
    if (!done) throw new StreamTransportError('Connection closed before model generation completed');
  } catch (error) {
    throw error instanceof StreamTransportError ? error
      : new StreamTransportError(error instanceof Error ? error.message : 'Model connection failed');
  } finally {
    try { await reader.cancel(); } catch { /* Network may already be closed. */ }
    reader.releaseLock();
  }
};

interface JsonStreamRequest<T> {
  systemPrompt: string;
  message: string;
  validate: (input: unknown) => ValidationResult<T>;
  onValue: (event: JsonStreamValue) => void;
  onAttempt: (attempt: number) => void;
  signal?: AbortSignal;
  label: string;
  maxAttempts?: number;
}

export const requestJsonStream = async <T>({
  systemPrompt, message, validate, onValue, onAttempt, signal, label, maxAttempts = 3,
}: JsonStreamRequest<T>): Promise<T> => {
  let problems: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted();
    onAttempt(attempt);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    // Bound a dead proxy/read as well as a silent upstream provider.
    const timer = setTimeout(() => controller.abort(new Error('Model stream timed out')), 200_000);
    const parser = new JsonObjectStream(onValue);
    let parseError: Error | undefined;
    try {
      let response: Response;
      try {
        response = await fetch(STREAM_API_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
          body: JSON.stringify({
            system_message: systemPrompt,
            message: attempt === 1 ? message : `${message}\n\nThe previous output was rejected:\n${problems.join('\n')}\nReturn a complete corrected JSON object, with each top-level field exactly once.`,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new StreamTransportError(error instanceof Error ? error.message : 'Model connection failed');
      }
      await consumeModelStream(response, (delta) => {
        if (parseError) return;
        try { parser.push(delta); } catch (error) {
          // Wait for the stream to end before retrying malformed output, never
          // mistake a transport fragment for an invalid model response.
          parseError = error instanceof Error ? error : new Error('Invalid model JSON');
        }
      });
      signal?.throwIfAborted();
      if (parseError) throw parseError;
      const result = validate(parser.finish());
      if (result.ok) return result.value;
      problems = result.errors;
    } catch (error) {
      signal?.throwIfAborted();
      // A disconnected stream is not an output-format retry. Retain valid
      // sections from this attempt and let the user explicitly retry.
      if (error instanceof StreamTransportError || controller.signal.aborted || error instanceof TypeError) throw error;
      problems = [error instanceof Error ? error.message : 'Invalid model stream'];
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  throw new Error(`${label}: the model returned an invalid format ${maxAttempts} times in a row. Last problems — ${problems.join('; ')}`);
};
