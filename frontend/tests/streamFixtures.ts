export const streamResponse = (events: unknown[]): Response => new Response(
  events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  { headers: { 'Content-Type': 'application/x-ndjson' } },
);

export const controlledStream = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { cancelled = true; },
  });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }),
    send: (event: unknown) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n')),
    close: () => controller.close(),
    fail: () => controller.error(new Error('Disconnected')),
    abortOn: (signal: AbortSignal) => signal.addEventListener('abort', () => {
      try { controller.error(signal.reason); } catch { /* Already closed. */ }
    }, { once: true }),
    isCancelled: () => cancelled,
  };
};
