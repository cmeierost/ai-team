/**
 * Component interface and Container base class.
 */

import type {
  IFocusableTuiComponent,
  ITuiComponent,
  ITuiContainer,
} from '@ai-team/core';

export type Component = ITuiComponent;
export type Focusable = IFocusableTuiComponent;

/** Type guard to check if a component implements Focusable */
export function isFocusable(component: Component | null): component is Component & Focusable {
  return component !== null && 'focused' in component;
}

/**
 * Cursor position marker — APC (Application Program Command) sequence.
 * Zero-width escape sequence that terminals ignore.
 * Components emit this at the cursor position when focused.
 */
export const CURSOR_MARKER = '\x1b_pi:c\x07';

/**
 * Container — a component that contains other components and renders them sequentially.
 */
export class Container implements ITuiContainer {
  children: Component[] = [];
  _parent: Container | null = null;

  addChild(component: Component): void {
    this.children.push(component);
    component._parent = this;
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
      component._parent = null;
    }
  }

  /** Remove this component from its parent container. */
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

  clear(): void {
    for (const child of this.children) {
      child._parent = null;
    }
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      const childLines = child.render(width);
      for (const line of childLines) {
        lines.push(line);
      }
    }
    return lines;
  }
}
