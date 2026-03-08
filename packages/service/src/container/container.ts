/**
 * ServiceContainer — a lightweight, annotation-free DI container.
 *
 * Inspired by .NET's IServiceProvider:
 *   - register()         declare a factory; first resolve() creates and caches the instance (singleton)
 *   - registerInstance() supply an already-constructed instance
 *   - resolve()          returns the singleton, constructing it on first call
 *   - tryResolve()       like resolve() but returns undefined when no registration exists
 *   - child()            create a scoped container that inherits parent registrations
 *
 * No reflection. No decorators. No `reflect-metadata`. Fully typed through Token<T>.
 *
 * Circular dependencies are detected at resolve-time and throw a descriptive error
 * listing the resolution chain so they are easy to diagnose.
 *
 * @example
 *   const c = new ServiceContainer();
 *   c.register(TOKENS.Foo, () => new Foo());
 *   c.register(TOKENS.Bar, c => new Bar(c.resolve(TOKENS.Foo)));
 *   const bar = c.resolve(TOKENS.Bar); // Bar is wired with Foo
 */

import type { Token } from './token.js';

type Factory<T> = (container: ServiceContainer) => T;

type Lifetime = 'singleton' | 'transient';

interface Registration {
  factory: Factory<unknown>;
  lifetime: Lifetime;
}

export class ServiceContainer {
  /** Resolved singleton instances. */
  private readonly singletons = new Map<string, unknown>();
  /** Registered factories (unresolved). */
  private readonly factories = new Map<string, Registration>();
  /** Tracks tokens currently being resolved for circular-dep detection. */
  private readonly resolving: string[] = [];
  /** Optional parent container; provides fallback factory lookup. */
  private readonly parent?: ServiceContainer;

  constructor(parent?: ServiceContainer) {
    this.parent = parent;
  }

  // ── Registration ─────────────────────────────────────────────────────────

  /**
   * Register a factory for token. The factory is called at most once; the
   * result is cached as a singleton and reused on subsequent resolve() calls.
   *
   * Calling register() a second time for the same token OVERRIDES the first
   * registration (enables plugin override before first resolve).
   */
  register<T>(token: Token<T>, factory: (c: ServiceContainer) => T): this {
    this.factories.set(token.id, {
      factory: factory as Factory<unknown>,
      lifetime: 'singleton',
    });
    // Clear any cached singleton so the new factory takes effect.
    this.singletons.delete(token.id);
    return this;
  }

  /**
   * Register a singleton factory explicitly.
   * Equivalent to register(), provided for clarity at call sites.
   */
  registerSingleton<T>(token: Token<T>, factory: (c: ServiceContainer) => T): this {
    return this.register(token, factory);
  }

  /**
   * Register a transient factory. A new instance is created on every resolve().
   */
  registerTransient<T>(token: Token<T>, factory: (c: ServiceContainer) => T): this {
    this.factories.set(token.id, {
      factory: factory as Factory<unknown>,
      lifetime: 'transient',
    });
    this.singletons.delete(token.id);
    return this;
  }

  /**
   * Register an already-constructed instance. Equivalent to
   * `register(token, () => instance)` but skips the factory entirely.
   */
  registerInstance<T>(token: Token<T>, instance: T): this {
    this.singletons.set(token.id, instance);
    // Remove any factory so re-registration doesn't shadow the instance.
    this.factories.delete(token.id);
    return this;
  }

  // ── Resolution ───────────────────────────────────────────────────────────

  /**
   * Resolve the singleton for token, constructing it via its factory on the
   * first call. Throws if no registration exists or a circular dep is detected.
   */
  resolve<T>(token: Token<T>): T {
    // 1. Singleton cache (includes parent singletons inherited via child())
    if (this.singletons.has(token.id)) {
      return this.singletons.get(token.id) as T;
    }

    // 2. Own factory
    const registration = this.factories.get(token.id);
    if (registration) {
      if (registration.lifetime === 'singleton') {
        return this._constructSingleton(token, registration.factory as Factory<T>);
      }
      return this._constructTransient(token, registration.factory as Factory<T>);
    }

    // 3. Delegate to parent, capturing the result as our own singleton
    if (this.parent) {
      const inherited = this.parent.resolve(token);
      this.singletons.set(token.id, inherited);
      return inherited;
    }

    throw new Error(
      `ServiceContainer: no registration for ${token}.\n` +
        `Resolution chain: ${this.resolving.join(' → ') || '(root)'}`,
    );
  }

  /**
   * Like resolve() but returns `undefined` instead of throwing when no
   * registration exists. Still throws on circular dependencies.
   */
  tryResolve<T>(token: Token<T>): T | undefined {
    try {
      return this.resolve(token);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith('ServiceContainer: no registration')) {
        return undefined;
      }
      throw e;
    }
  }

  /**
   * True if the token is registered (in this container or its parent).
   */
  has(token: Token<unknown>): boolean {
    return (
      this.singletons.has(token.id) ||
      this.factories.has(token.id) ||
      (this.parent?.has(token) ?? false)
    );
  }

  // ── Scoped child ─────────────────────────────────────────────────────────

  /**
   * Create a child container that inherits all parent registrations.
   * New registrations in the child shadow the parent without modifying it.
   * Useful for per-request or per-session scopes.
   */
  child(): ServiceContainer {
    return new ServiceContainer(this);
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _constructSingleton<T>(token: Token<T>, factory: Factory<T>): T {
    if (this.resolving.includes(token.id)) {
      throw new Error(
        `ServiceContainer: circular dependency detected.\n` +
          `Resolution chain: ${[...this.resolving, token.id].join(' → ')}`,
      );
    }

    this.resolving.push(token.id);
    try {
      const instance = factory(this);
      this.singletons.set(token.id, instance);
      return instance;
    } finally {
      this.resolving.pop();
    }
  }

  private _constructTransient<T>(token: Token<T>, factory: Factory<T>): T {
    if (this.resolving.includes(token.id)) {
      throw new Error(
        `ServiceContainer: circular dependency detected.\n` +
          `Resolution chain: ${[...this.resolving, token.id].join(' → ')}`,
      );
    }

    this.resolving.push(token.id);
    try {
      return factory(this);
    } finally {
      this.resolving.pop();
    }
  }
}
