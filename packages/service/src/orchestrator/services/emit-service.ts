import { AsyncLocalStorage } from 'node:async_hooks';
import type { RuntimeStreamEvent } from '@ai-team/api-contracts';

export type RuntimeEventEmitter = (event: RuntimeStreamEvent) => void;

export class EmitService {
  private readonly store = new AsyncLocalStorage<RuntimeEventEmitter | undefined>();
  private defaultEmitter: RuntimeEventEmitter | undefined;

  runWithEmitter<T>(emitter: RuntimeEventEmitter | undefined, fn: () => Promise<T>): Promise<T> {
    return this.store.run(emitter, fn);
  }

  emit(event: RuntimeStreamEvent): void {
    const emitter = this.store.getStore() ?? this.defaultEmitter;
    emitter?.(event);
  }

  hasEmitter(): boolean {
    return Boolean(this.store.getStore() ?? this.defaultEmitter);
  }

  setDefaultEmitter(emitter: RuntimeEventEmitter | undefined): void {
    this.defaultEmitter = emitter;
  }
}
