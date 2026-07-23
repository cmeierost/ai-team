/**
 * Status line component — renders at the bottom of the TUI.
 */

import { Component, truncateToWidth, visibleWidth } from '@ai-team/tui';

/**
 * Status line state.
 */
export interface StatusLineState {
  /** Left-aligned text */
  left?: string;
  /** Right-aligned text */
  right?: string;
  /** Status mode (e.g., 'normal', 'insert', 'visual') */
  mode?: string;
}

/**
 * Status line — always visible at the bottom of the TUI.
 */
export class StatusLine implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private state: StatusLineState = {};

  setState(state: Partial<StatusLineState>): void {
    Object.assign(this.state, state);
  }

  setLeft(text: string | undefined): void {
    this.state.left = text;
  }

  setRight(text: string | undefined): void {
    this.state.right = text;
  }

  setMode(mode: string | undefined): void {
    this.state.mode = mode;
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
    const dimStyle = '\x1b[2m';
    const boldStyle = '\x1b[1m';
    const bgStyle = '\x1b[4m';
    const reset = '\x1b[0m';

    const leftParts: string[] = [];

    // Mode indicator
    if (this.state.mode) {
      leftParts.push(`${boldStyle}${bgStyle}[${this.state.mode.toUpperCase()}]${reset}`);
    }

    // Left text
    if (this.state.left) {
      leftParts.push(`${dimStyle}${this.state.left}${reset}`);
    }

    const rightText = this.state.right ?? '';
    const rightWidth = visibleWidth(rightText);
    const gapWidth = rightText ? 1 : 0;
    const leftAvailable = Math.max(0, width - rightWidth - gapWidth);
    const left = truncateToWidth(leftParts.join(' '), leftAvailable);
    const padding = Math.max(0, width - visibleWidth(left) - rightWidth);
    const line = `${left}${' '.repeat(padding)}${
      rightText ? `${dimStyle}${rightText}${reset}` : ''
    }`;

    // Full width background
    return [
      `\x1b[100m\x1b[37m${truncateToWidth(line, width)}${' '.repeat(
        Math.max(0, width - visibleWidth(line))
      )}${reset}`,
    ];
  }
}
