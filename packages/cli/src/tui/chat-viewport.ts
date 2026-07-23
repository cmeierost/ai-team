/**
 * Chat viewport — manages scrollable chat content.
 */

import { Component, Container } from '@ai-team/tui';

/**
 * Chat viewport — renders a scrollable region of chat content.
 */
export class ChatViewport implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private content: Container;
  private scrollOffset = 0;
  private maxScrollOffset = 0;
  private maxVisibleLines = 20;
  private autoScroll = true;

  constructor() {
    this.content = new Container();
  }

  /**
   * Get the content container to add chat messages to.
   */
  getContent(): Container {
    return this.content;
  }

  /**
   * Set the maximum number of visible lines.
   */
  setMaxVisibleLines(lines: number): void {
    this.maxVisibleLines = lines;
  }

  /**
   * Get the total number of lines in the content.
   */
  getTotalLines(): number {
    const allLines = this.content.render(80);
    return allLines.length;
  }

  /**
   * Scroll to the bottom.
   */
  scrollToBottom(): void {
    this.autoScroll = true;
    this.scrollOffset = 0;
  }

  /** Jump to the beginning of the transcript. */
  scrollToTop(): void {
    this.autoScroll = false;
    this.scrollOffset = 0;
  }

  /**
   * Scroll up by N lines.
   */
  scrollUp(lines: number): void {
    this.autoScroll = false;
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
  }

  /**
   * Scroll down by N lines.
   */
  scrollDown(lines: number): void {
    this.scrollOffset = Math.min(
      this.maxScrollOffset,
      this.scrollOffset + lines
    );
    if (this.scrollOffset === this.maxScrollOffset) {
      this.autoScroll = true;
    }
  }

  /**
   * Handle input for scrolling.
   */
  handleInput(data: string): void {
    if (data === 'wheel-up') {
      this.scrollUp(3);
      return;
    }
    if (data === 'wheel-down') {
      this.scrollDown(3);
      return;
    }
    // Page up/down. Terminals use CSI parameters for modified keys, so accept
    // both the common ESC[5~ form and variants such as ESC[5;2~.
    if (/^\x1b\[5(?:;\d+)*~$/.test(data)) {
      this.scrollUp(10);
      return;
    }
    if (/^\x1b\[6(?:;\d+)*~$/.test(data)) {
      this.scrollDown(10);
      return;
    }
    if (data === '\x1b[H' || data === '\x1b[1~' || data === '\x1b[1;5H') {
      this.scrollToTop();
      return;
    }
    if (data === '\x1b[F' || data === '\x1b[4~' || data === '\x1b[4;5~') {
      this.scrollToBottom();
      return;
    }
    // Ctrl+U/D for half-page scroll
    if (data === '\x1b[1;5A') { // Ctrl+Up
      this.scrollUp(5);
      return;
    }
    if (data === '\x1b[1;5B') { // Ctrl+Down
      this.scrollDown(5);
      return;
    }
  }

remove(): void {
    const parent = this._parent;
    if (parent) {
      const idx = parent.children.indexOf(this);
      if (idx !== -1) {
        parent.children.splice(idx, 1);
      }
      this._parent = null;
    }
  }

  invalidate(): void {
    // No-op
  }

  render(width: number): string[] {
    const allLines = this.content.render(width);
    const totalLines = allLines.length;
    this.maxScrollOffset = Math.max(0, totalLines - this.maxVisibleLines);

    if (this.autoScroll) {
      this.scrollOffset = this.maxScrollOffset;
    } else {
      this.scrollOffset = Math.min(this.scrollOffset, this.maxScrollOffset);
    }

    const startLine = this.scrollOffset;
    const endLine = Math.min(startLine + this.maxVisibleLines, totalLines);
    const visible = allLines.slice(startLine, endLine);

    return visible;
  }
}
