/**
 * View stack renderer — a Component that renders the current view
 * from the WorkflowViewStack.
 */

import { Component } from '@ai-team/tui';
import { WorkflowViewStack } from './workflow-view-stack.js';

/**
 * Renders the top view from the workflow view stack.
 */
export class ViewStackRenderer implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private readonly stack: WorkflowViewStack;

  constructor(stack: WorkflowViewStack) {
    this.stack = stack;
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
    const view = this.stack.getCurrentContent();
    if (!view) return [];
    return view.render(width);
  }
}
