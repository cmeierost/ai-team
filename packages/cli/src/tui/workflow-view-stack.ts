/**
 * Workflow view stack — manages views pushed/popped on subworkflow boundaries.
 */

import { Component } from '@ai-team/tui';

/**
 * A single view in the stack.
 */
export interface WorkflowView {
  /** Workflow name/identifier */
  workflowName: string;
  /** View content component */
  content: Component;
  /** Timestamp when view was created */
  timestamp: number;
}

/**
 * Workflow view stack — push/pop views on subworkflow boundaries.
 */
export class WorkflowViewStack {
  private stack: WorkflowView[] = [];
  private onChange?: () => void;

  /**
   * Get the current (top) view.
   */
  getCurrent(): WorkflowView | undefined {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
  }

  /**
   * Get the current view's content component.
   */
  getCurrentContent(): Component | undefined {
    return this.getCurrent()?.content;
  }

  /**
   * Get the current workflow name.
   */
  getCurrentWorkflowName(): string | undefined {
    return this.getCurrent()?.workflowName;
  }

  /**
   * Push a new view onto the stack (subworkflow started).
   */
  push(workflowName: string, content: Component): void {
    this.stack.push({
      workflowName,
      content,
      timestamp: Date.now(),
    });
    this.onChange?.();
  }

  /**
   * Pop the current view (subworkflow ended).
   */
  pop(): WorkflowView | undefined {
    const view = this.stack.pop();
    this.onChange?.();
    return view;
  }

  /**
   * Get the stack depth.
   */
  get depth(): number {
    return this.stack.length;
  }

  /**
   * Get all views in the stack.
   */
  getAll(): ReadonlyArray<WorkflowView> {
    return this.stack;
  }

  /**
   * Clear the stack.
   */
  clear(): void {
    this.stack = [];
    this.onChange?.();
  }

  /**
   * Register a change handler.
   */
  onChangeEvent(handler: () => void): void {
    this.onChange = handler;
  }
}
