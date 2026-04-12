/**
 * Async utilities shared across core and service modules.
 */

/**
 * Race a promise against a timeout.
 * Throws with `timeoutMessage` if the promise doesn't settle within `timeoutMs`.
 */
export async function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Wrap a promise so that it rejects if the given AbortSignal fires first.
 * If `signal` is undefined the promise is returned unchanged.
 */
export async function withAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  abortMessage: string
): Promise<T> {
  if (!signal) return promise;

  if (signal.aborted) throw new Error(abortMessage);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error(abortMessage));
    };

    const cleanup = () => signal.removeEventListener('abort', onAbort);

    signal.addEventListener('abort', onAbort, { once: true });

    promise
      .then((value) => {
        cleanup();
        resolve(value);
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}

/** Returns true if the error message indicates an abort. */
export function isAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /aborted|abort/i.test(message);
}

/** Throws if the signal has already fired. */
export function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) throw new Error(message);
}
