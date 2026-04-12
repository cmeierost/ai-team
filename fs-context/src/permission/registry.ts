import type { GlobalContext, ParsedPermFile, ResolvedContext } from './types.js';
import { resolveContext } from './resolver.js';
import { ContextRuntime } from './context-runtime.js';

export class ContextRegistry {
  private perms = new Map<string, ParsedPermFile>();
  private global: GlobalContext;
  private filesystemFiles?: Set<string>;
  readonly runtime: ContextRuntime;

  constructor(global: GlobalContext, runtime: ContextRuntime, filesystemFiles?: Set<string>) {
    this.global = global;
    this.runtime = runtime;
    this.filesystemFiles = filesystemFiles;
  }

  register(id: string, perm: ParsedPermFile): ResolvedContext {
    this.perms.set(id, perm);
    const resolved = resolveContext(perm, this.global, this.filesystemFiles);
    this.runtime.register(id, resolved);
    return resolved;
  }

  resolve(id: string): ResolvedContext | undefined {
    return this.runtime.getResolved(id);
  }

  unregister(id: string): void {
    this.perms.delete(id);
    this.runtime.unregister(id);
  }

  reregister(id: string): ResolvedContext | undefined {
    const perm = this.perms.get(id);
    if (!perm) return undefined;
    const resolved = resolveContext(perm, this.global, this.filesystemFiles);
    this.runtime.register(id, resolved);
    return resolved;
  }

  updateGlobal(global: GlobalContext): void {
    this.global = global;
    for (const [id] of this.perms) {
      this.reregister(id);
    }
  }

  all(): Map<string, ResolvedContext> {
    return this.runtime.allContexts();
  }
}
