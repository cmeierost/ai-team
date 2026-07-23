import type { ITerminal } from '@ai-team/core';
import { ComponentSlot, type Component, type Loader } from '@ai-team/tui';
import type { ChatView } from './chat-view.js';
import type { StatusLine } from './status-line.js';

/**
 * Height-aware interactive layout. Transcript entries remain chronological
 * while the composer and footer stay anchored to the bottom terminal rows.
 */
export class ChatLayout implements Component {
  _parent: import('@ai-team/tui').Container | null = null;
  private isFocused = false;
  private readonly composer: ComponentSlot;
  private inlineCommitCount = 0;

  constructor(
    private readonly terminal: ITerminal,
    private readonly chat: ChatView,
    private readonly spinner: Loader,
    composer: Component,
    private readonly footer: StatusLine,
    private readonly inlineScrollback = false
  ) {
    this.composer = new ComponentSlot(composer);
  }

  setComposer(component: Component): void {
    this.composer.set(component);
  }

  pushComposer(component: Component): () => void {
    return this.composer.push(component);
  }

  /** Number of leading rendered rows safe to commit to terminal scrollback. */
  getInlineCommitCount(): number {
    return this.inlineCommitCount;
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.composer.focused = value;
  }

  handleInput(data: string): void {
    const wheel = /^\x1b\[<(64|65);\d+;\d+[mM]$/.exec(data);
    if (wheel) {
      this.chat.handleInput(wheel[1] === '64' ? 'wheel-up' : 'wheel-down');
      return;
    }
    if (
      /^\x1b\[5(?:;\d+)*~$/.test(data)
      || /^\x1b\[6(?:;\d+)*~$/.test(data)
      || data === '\x1b[1;5A'
      || data === '\x1b[1;5B'
      || data === '\x1b[H'
      || data === '\x1b[F'
      || data === '\x1b[1~'
      || data === '\x1b[4~'
      || data === '\x1b[1;5H'
      || data === '\x1b[4;5~'
    ) {
      this.chat.handleInput(data);
      return;
    }
    this.composer.handleInput(data);
  }

  remove(): void {
    this._parent?.removeChild(this);
  }

  invalidate(): void {
    this.chat.invalidate();
    this.spinner.invalidate();
    this.composer.invalidate();
    this.footer.invalidate();
  }

  render(width: number): string[] {
    const spinnerLines = this.spinner.render(width);
    const promptLines = this.composer.render(width);
    const footerLines = this.footer.render(width);
    const fixedRows =
      spinnerLines.length + promptLines.length + footerLines.length;
    const transcriptRows = Math.max(0, this.terminal.rows - fixedRows);

    if (this.inlineScrollback) {
      const transcript = this.chat.renderAll(width);
      this.inlineCommitCount = Math.max(0, transcript.length - transcriptRows);
      const padding = Array.from(
        { length: Math.max(0, transcriptRows - transcript.length) },
        () => ''
      );
      return [
        ...padding,
        ...transcript,
        ...spinnerLines,
        ...promptLines,
        ...footerLines,
      ];
    }

    this.inlineCommitCount = 0;
    this.chat.setVisibleLines(transcriptRows);
    const transcript = transcriptRows > 0 ? this.chat.render(width) : [];
    const padding = Array.from(
      { length: Math.max(0, transcriptRows - transcript.length) },
      () => ''
    );

    return [
      ...transcript,
      ...padding,
      ...spinnerLines,
      ...promptLines,
      ...footerLines,
    ].slice(-this.terminal.rows);
  }
}
