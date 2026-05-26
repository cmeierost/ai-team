import type { RuntimeStreamEvent } from '@ai-team/api-contracts';

export interface IEmitService {
  emit(event: RuntimeStreamEvent): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  status(phase: string, message?: string): void;
  token(text: string): void;
}

/**
 * Per-connection event emitter.
 * Construct at connection time; the DI container provides per-connection
 * isolation via a scoped child container — no AsyncLocalStorage needed.
 */
export class EmitService implements IEmitService {
  constructor(private readonly emitter: (event: RuntimeStreamEvent) => void) {}

  emit(event: RuntimeStreamEvent): void {
    this.emitter(event);
  }

  log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit({ kind: 'log', level, message });
  }

  status(phase: string, message?: string): void {
    this.emit({ kind: 'status', phase, message });
  }

  token(text: string): void {
    if (text) this.emit({ kind: 'token', text });
  }
}
