import type { ITerminal } from '@ai-team/core';
import type { Component, Loader } from '@ai-team/tui';
import type { ChatView } from './chat-view.js';
import type { HeaderBar } from './header-bar.js';
import type { Prompt } from './prompt.js';
import type { StatusLine } from './status-line.js';

/**
 * Height-aware interactive layout. Transcript entries remain chronological
 * while the composer and footer stay anchored to the bottom terminal rows.
 */
export class ChatLayout implements Component {
  _parent: import('@ai-team/tui').Container | null = null;
  private isFocused = false;

  constructor(
    private readonly terminal: ITerminal,
    private readonly header: HeaderBar,
    private readonly chat: ChatView,
    private readonly spinner: Loader,
    private prompt: Prompt,
    private readonly footer: StatusLine
  ) {}

  setPrompt(prompt: Prompt): void {
    this.prompt.focused = false;
    this.prompt = prompt;
    this.prompt.focused = this.isFocused;
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.prompt.focused = value;
  }

  handleInput(data: string): void {
    if (
      data === '\x1b[5~'
      || data === '\x1b[6~'
      || data === '\x1b[1;5A'
      || data === '\x1b[1;5B'
    ) {
      this.chat.handleInput(data);
      return;
    }
    this.prompt.handleInput(data);
  }

  remove(): void {
    this._parent?.removeChild(this);
  }

  invalidate(): void {
    this.header.invalidate();
    this.chat.invalidate();
    this.spinner.invalidate();
    this.prompt.invalidate();
    this.footer.invalidate();
  }

  render(width: number): string[] {
    const headerLines = this.header.render(width);
    const topLines = headerLines.length > 0 ? [...headerLines, ''] : [];
    const spinnerLines = this.spinner.render(width);
    const promptLines = this.prompt.render(width);
    const footerLines = this.footer.render(width);
    const fixedRows =
      topLines.length + spinnerLines.length + promptLines.length + footerLines.length;
    const transcriptRows = Math.max(0, this.terminal.rows - fixedRows);

    this.chat.setVisibleLines(transcriptRows);
    const transcript = transcriptRows > 0 ? this.chat.render(width) : [];
    const padding = Array.from(
      { length: Math.max(0, transcriptRows - transcript.length) },
      () => ''
    );

    return [
      ...topLines,
      ...transcript,
      ...padding,
      ...spinnerLines,
      ...promptLines,
      ...footerLines,
    ].slice(-this.terminal.rows);
  }
}
