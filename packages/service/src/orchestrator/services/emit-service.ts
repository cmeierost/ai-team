import type { RuntimeStreamEvent } from '@ai-team/api-contracts';

/**
 * Per-connection event emitter holder.
 * Construct with the emitter at connection time; the DI container
 * provides isolation — no AsyncLocalStorage needed.
 */
export class EmitService {
  constructor(private readonly emitter: (event: RuntimeStreamEvent) => void) {}

  emit(event: RuntimeStreamEvent): void {
    this.emitter(event);
  }
}
