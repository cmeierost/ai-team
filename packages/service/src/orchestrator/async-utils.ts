/**
 * Async utilities: timeout wrapping, abort-signal wrapping, and abort detection.
 *
 * Lives in the orchestrator layer so the orchestrator (and any future pipeline
 * stage) can wrap LLM calls, tool calls, streaming, etc. with consistent
 * abort and timeout behaviour without depending on the CLI adapter.
 *
 * These are pure utilities with no I/O dependencies.
 */

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  abortMessage: string,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw new Error(abortMessage);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(new Error(abortMessage)); };
    const cleanup = () => { signal.removeEventListener('abort', onAbort); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise
      .then((value) => { cleanup(); resolve(value); })
      .catch((error) => { cleanup(); reject(error); });
  });
}

export function isAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /aborted|abort/i.test(message);
}

export function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) throw new Error(message);
}
