import type { Component } from '../component.js';
import { isFocusable } from '../component.js';

/**
 * A focus-aware, single-component stack. Pushing a component temporarily
 * replaces the visible component; popping restores the previous component.
 */
export class ComponentSlot implements Component {
  _parent: import('../component.js').Container | null = null;
  private readonly stack: Component[] = [];
  private isFocused = false;

  constructor(component?: Component) {
    if (component) this.stack.push(component);
  }

  get current(): Component | undefined {
    return this.stack.at(-1);
  }

  get depth(): number {
    return this.stack.length;
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.syncFocus();
  }

  set(component: Component): void {
    this.blurCurrent();
    this.stack.splice(0, this.stack.length, component);
    this.syncFocus();
  }

  push(component: Component): () => void {
    this.blurCurrent();
    this.stack.push(component);
    this.syncFocus();
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      this.removeComponent(component);
    };
  }

  pop(): Component | undefined {
    const component = this.stack.pop();
    if (component && isFocusable(component)) component.focused = false;
    this.syncFocus();
    return component;
  }

  clear(): void {
    this.blurCurrent();
    this.stack.length = 0;
  }

  handleInput(data: string): void {
    this.current?.handleInput?.(data);
  }

  invalidate(): void {
    this.current?.invalidate();
  }

  render(width: number): string[] {
    return this.current?.render(width) ?? [];
  }

  remove(): void {
    this._parent?.removeChild(this);
  }

  private removeComponent(component: Component): void {
    const index = this.stack.lastIndexOf(component);
    if (index === -1) return;
    const wasCurrent = index === this.stack.length - 1;
    if (wasCurrent && isFocusable(component)) component.focused = false;
    this.stack.splice(index, 1);
    if (wasCurrent) this.syncFocus();
  }

  private blurCurrent(): void {
    const current = this.current;
    if (current && isFocusable(current)) current.focused = false;
  }

  private syncFocus(): void {
    const current = this.current;
    if (current && isFocusable(current)) current.focused = this.isFocused;
  }
}
