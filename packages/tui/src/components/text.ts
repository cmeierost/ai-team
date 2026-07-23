/**
 * Basic text component.
 */

import { Component } from '../component.js';

export interface TextOptions {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  fg?: string | { r: number; g: number; b: number };
  bg?: string | { r: number; g: number; b: number };
}

/**
 * Simple text component that renders styled text.
 */
export class Text implements Component {
  _parent: import("../component.js").Container | null = null;
  private text: string;
  private options: TextOptions;
  private cachedStyle?: string;

  constructor(text: string, options: TextOptions = {}) {
    this.text = text;
    this.options = options;
  }

  setText(text: string): void {
    this.text = text;
    this.invalidate();
  }

  setOption(key: keyof TextOptions, value: boolean | string | { r: number; g: number; b: number } | undefined): void {
    (this.options as Record<string, unknown>)[key] = value;
    this.invalidate();
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
    this.cachedStyle = undefined;
  }

  render(_width: number): string[] {
    const style = this.buildStyle();
    if (!style) return [this.text];
    return [`${style}${this.text}\x1b[0m`];
  }

  private buildStyle(): string {
    if (this.cachedStyle) return this.cachedStyle;

    let style = '';
    const { bold, dim, italic, underline, inverse, fg, bg } = this.options;

    if (bold) style += '\x1b[1m';
    if (dim) style += '\x1b[2m';
    if (italic) style += '\x1b[3m';
    if (underline) style += '\x1b[4m';
    if (inverse) style += '\x1b[7m';

    if (fg) {
      style += this.colorCode(fg, '38');
    }

    if (bg) {
      style += this.colorCode(bg, '48');
    }

    this.cachedStyle = style;
    return style;
  }

  private colorCode(color: string | { r: number; g: number; b: number }, channel: string): string {
    if (typeof color === 'object' && 'r' in color) {
      return `\x1b[${channel};2;${color.r};${color.g};${color.b}m`;
    }

    // Named colors
    const namedColors: Record<string, string> = {
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      gray: '\x1b[90m',
    };

    if (channel === '38' && namedColors[color]) {
      return namedColors[color];
    }

    // Background named colors
    const bgNamedColors: Record<string, string> = {
      red: '\x1b[41m',
      green: '\x1b[42m',
      yellow: '\x1b[43m',
      blue: '\x1b[44m',
      magenta: '\x1b[45m',
      cyan: '\x1b[46m',
      white: '\x1b[47m',
    };

    if (channel === '48' && bgNamedColors[color]) {
      return bgNamedColors[color];
    }

    return '';
  }
}
