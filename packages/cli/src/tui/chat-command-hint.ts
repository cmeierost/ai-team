import { Component, truncateToWidth } from '@ai-team/tui';

/** A quiet, chat-specific command reminder shown once at session startup. */
export class ChatCommandHint implements Component {
  _parent: import('@ai-team/tui').Container | null = null;

  constructor(private readonly text: string) {}

  remove(): void {
    this._parent?.removeChild(this);
  }

  invalidate(): void {
    // Static content.
  }

  render(width: number): string[] {
    return [truncateToWidth(`\x1b[2m${this.text}\x1b[0m`, width)];
  }
}
