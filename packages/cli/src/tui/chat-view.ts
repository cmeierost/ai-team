/**
 * Chat view — the main chat display for a single workflow.
 */

import { Component, Container, Spacer } from '@ai-team/tui';
import { ChatViewport } from './chat-viewport.js';

/**
 * Chat view — contains the viewport and input area for a workflow chat.
 */
export class ChatView implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private viewport: ChatViewport;
  private container: Container;

  constructor() {
    this.viewport = new ChatViewport();
    this.container = new Container();
    this.container.addChild(this.viewport);
  }

  /**
   * Get the viewport to add messages to.
   */
  getViewport(): ChatViewport {
    return this.viewport;
  }

  /**
   * Get the content container (inside the viewport).
   */
  getContent(): Container {
    return this.viewport.getContent();
  }

  /**
   * Set the number of visible lines in the viewport.
   */
  setVisibleLines(lines: number): void {
    this.viewport.setMaxVisibleLines(lines);
  }

  /**
   * Scroll to the bottom.
   */
  scrollToBottom(): void {
    this.viewport.scrollToBottom();
  }

  /**
   * Handle transcript navigation while the composer remains active.
   */
  handleInput(data: string): void {
    this.viewport.handleInput(data);
  }

  /**
   * Add a spacer between messages.
   */
  addSpacer(): void {
    this.getContent().addChild(new Spacer(1));
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
    this.container.invalidate();
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  /** Render every transcript row without applying the internal viewport. */
  renderAll(width: number): string[] {
    return this.viewport.renderAll(width);
  }
}
