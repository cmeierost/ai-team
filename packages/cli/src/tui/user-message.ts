import type { Component } from '@ai-team/tui';

/**
 * User-side transcript entry. Slash-command results are attached here because
 * the service executes slash commands through the shared command/tool/workflow
 * interface while their result remains user-message content.
 */
export class UserMessage implements Component {
  _parent: import('@ai-team/tui').Container | null = null;
  private result?: string;
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

  setResult(result: string): void {
    this.result = result;
  }

  render(_width: number): string[] {
    const identity = this.developerName ? `${this.developerName} ` : '';
    const lines = [`\x1b[1m${identity}›\x1b[0m ${this.message}`];
    if (this.result) {
      lines.push(...this.result.split('\n').map((line) => `  ${line}`));
    }
    return lines;
  }

  invalidate(): void {}

  remove(): void {
    this._parent?.removeChild(this);
  }
}
