import type { AccessContext } from './types.js';
import { CompiledRuleSet } from './policy.js';

/**
 * Holds registered contexts and their compiled rule sets.
 * Invalidates compiled matchers when a context is updated.
 */
export class ContextRegistry {
  private readonly contexts = new Map<string, AccessContext>();
  private readonly compiled = new Map<string, CompiledRuleSet>();
  private globalContextId: string | null = null;
  private activeContextId: string | null = null;

  /** Register or replace a context. */
  register(ctx: AccessContext): void {
    this.contexts.set(ctx.id, ctx);
    this.compiled.delete(ctx.id); // invalidate cache
  }

  /** Update an existing context (merges, re-compiles). */
  update(id: string, patch: Partial<Omit<AccessContext, 'id'>>): void {
    const existing = this.contexts.get(id);
    if (!existing) throw new Error(`Context not found: ${id}`);
    const updated = { ...existing, ...patch, id };
    this.contexts.set(id, updated);
    this.compiled.delete(id);
  }

  /** Remove a context by ID. */
  remove(id: string): boolean {
    this.compiled.delete(id);
    if (this.globalContextId === id) this.globalContextId = null;
    if (this.activeContextId === id) this.activeContextId = null;
    return this.contexts.delete(id);
  }

  /** Get a context by ID. */
  get(id: string): AccessContext | undefined {
    return this.contexts.get(id);
  }

  /** All registered context IDs. */
  ids(): string[] {
    return [...this.contexts.keys()];
  }

  /** Designate the global (baseline) context. Must be registered first. */
  setGlobal(id: string): void {
    if (!this.contexts.has(id)) throw new Error(`Context not found: ${id}`);
    this.globalContextId = id;
  }

  /** Get the global context ID (if set). */
  getGlobalId(): string | null {
    return this.globalContextId;
  }

  /** Set the active (current) context. Must be registered first. */
  setActive(id: string): void {
    if (!this.contexts.has(id)) throw new Error(`Context not found: ${id}`);
    this.activeContextId = id;
  }

  /** Get the active context ID (if set). */
  getActiveId(): string | null {
    return this.activeContextId;
  }

  /** Get compiled rule set for a context (lazy, cached). */
  getCompiled(id: string): CompiledRuleSet {
    let rs = this.compiled.get(id);
    if (rs) return rs;

    const ctx = this.contexts.get(id);
    if (!ctx) throw new Error(`Context not found: ${id}`);

    rs = new CompiledRuleSet(ctx.rules);
    this.compiled.set(id, rs);
    return rs;
  }
}
