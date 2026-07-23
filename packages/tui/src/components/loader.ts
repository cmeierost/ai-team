/**
 * Loader/spinner component.
 */

import { Component } from '../component.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Animated spinner component.
 */
export class Loader implements Component {
  _parent: import("../component.js").Container | null = null;
  private message: string;
  private frame = 0;
  private intervalId?: ReturnType<typeof setInterval>;
  private visible = true;
  private onFrame?: () => void;

  constructor(message = 'Loading...') {
    this.message = message;
  }

  setMessage(message: string): void {
    this.message = message;
    this.onFrame?.();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      this.start();
    } else {
      this.stop();
    }
    this.onFrame?.();
  }

  start(onFrame?: () => void): void {
    this.stop();
    this.onFrame = onFrame;
    this.intervalId = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      this.onFrame?.();
    }, 80);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
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

  render(_width: number): string[] {
    if (!this.visible) return [];

    const spinner = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    return [`${spinner} ${this.message}`];
  }
}
