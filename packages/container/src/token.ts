import type { IContainerToken } from '@ai-team/core';

export class Token<T> implements IContainerToken<T> {
  declare readonly __type?: T;

  constructor(readonly id: string) {}

  toString(): string {
    return `Token(${this.id})`;
  }
}
