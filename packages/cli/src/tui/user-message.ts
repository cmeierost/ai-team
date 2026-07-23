import type { Component } from '@ai-team/tui';

/** User-side transcript entry. Tool and slash results render separately. */
export class UserMessage implements Component {
  _parent: import('@ai-team/tui').Container | null = null;
  private developerName?: string;

  constructor(
    private readonly message: string,
    developerName?: string
  ) {
    this.developerName = developerName?.trim() || undefined;
  }

  setDeveloperName(developerName: string): void {
    this.developerName = developerName.trim() || undefined;
  }

  render(_width: number): string[] {
    const identity = this.developerName ? `${this.developerName} ` : '';
    return [`\x1b[1m${identity}›\x1b[0m ${this.message}`];
  }

  invalidate(): void {}

  remove(): void {
    this._parent?.removeChild(this);
  }
}
