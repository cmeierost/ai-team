import { EmitService } from '@ai-team/service';

/**
 * CLI transport sink for runtime events.
 * Tokens stream to stdout; log events route to stdout/stderr.
 */
export function createConsoleEmitService(): EmitService {
  return new EmitService((event) => {
    const record = event as Record<string, unknown>;
    if (event.kind === 'token' && typeof record.text === 'string' && record.text.length > 0) {
      process.stdout.write(record.text);
      return;
    }

    if (event.kind === 'log' && typeof record.message === 'string') {
      if (record.level === 'error') {
        process.stderr.write(`${record.message}\n`);
      } else {
        process.stdout.write(`${record.message}\n`);
      }
    }
  });
}
