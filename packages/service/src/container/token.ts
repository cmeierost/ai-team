/**
 * Token<T> — a typed registration key for the ServiceContainer.
 *
 * The generic parameter carries the resolved type; the string id is only used
 * as the Map key at runtime. Token instances should be created once and
 * exported as constants (see tokens.ts) so callers share the same reference.
 *
 * @example
 *   export const MY_SERVICE = new Token<MyService>('MyService');
 *   container.register(MY_SERVICE, c => new MyService(c.resolve(OTHER)));
 *   const svc = container.resolve(MY_SERVICE); // typed as MyService
 */
export class Token<T> {
  declare readonly __type?: T;

  constructor(readonly id: string) {}
  toString(): string {
    return `Token(${this.id})`;
  }
}
