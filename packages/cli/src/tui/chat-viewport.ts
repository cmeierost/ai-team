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
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
    if (this.scrollOffset === 0) {
      this.autoScroll = true;
    }
  }

  /**
   * Handle input for scrolling.
   */
  handleInput(data: string): void {
    // Page up/down
    if (data === '\x1b[5~') { // Page Up
      this.scrollUp(10);
      return;
    }
    if (data === '\x1b[6~') { // Page Down
      this.scrollDown(10);
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

    if (this.autoScroll) {
      this.scrollOffset = Math.max(0, totalLines - this.maxVisibleLines);
    }

    const startLine = this.scrollOffset;
    const endLine = Math.min(startLine + this.maxVisibleLines, totalLines);
    const visible = allLines.slice(startLine, endLine);

    return visible;
  }
}
