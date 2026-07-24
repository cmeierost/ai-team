function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

export function reportFrontendError(
  error: unknown,
  context: Record<string, unknown> = {}
): void {
  void fetch('/api/logs/frontend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...context,
      error: normalizeError(error),
      location: window.location.href,
      userAgent: navigator.userAgent,
    }),
    keepalive: true,
  }).catch(() => {
    // The browser console remains the fallback when the API is unavailable.
  });
}

export function installFrontendErrorReporting(): void {
  window.addEventListener('error', (event) => {
    reportFrontendError(event.error ?? event.message, {
      phase: 'window-error',
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportFrontendError(event.reason, { phase: 'unhandled-rejection' });
  });
}
