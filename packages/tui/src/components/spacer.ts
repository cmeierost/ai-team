/**
 * Spacer component — renders empty lines.
 */

import { Component } from '../component.js';

/**
 * Spacer — renders a configurable number of empty lines.
 */
export class Spacer implements Component {
  _parent: import("../component.js").Container | null = null;
  private lines: number;

  constructor(lines = 1) {
    this.lines = lines;
  }

  setLines(count: number): void {
    this.lines = count;
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
    const result: string[] = [];
    const padding = ' '.repeat(Math.min(width, 80));
    for (let i = 0; i < this.lines; i++) {
      result.push(padding);
    }
    return result;
  }
}
