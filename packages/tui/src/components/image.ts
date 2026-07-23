/**
 * Terminal image component using Kitty graphics protocol and iTerm2.
 */

import { Component } from '../component.js';

/**
 * Image format for terminal display.
 */
export interface TerminalImageOptions {
  /** Width in columns (approximate) */
  width?: number;
  /** Height in rows (approximate) */
  height?: number;
  /** Preserve aspect ratio */
  preserveAspectRatio?: boolean;
}

/**
 * Detect terminal image protocol support.
 */
export function detectImageProtocol(): 'kitty' | 'iterm2' | null {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || '';

  if (termProgram === 'kitty') {
    return 'kitty';
  }

  if (termProgram === 'iterm-app') {
    return 'iterm2';
  }

  // Check TERM for Kitty
  const term = process.env.TERM || '';
  if (term.includes('kitty')) {
    return 'kitty';
  }

  // Check for Kitty graphics env var
  if (process.env.KITTY_PROTOCOL) {
    return 'kitty';
  }

  return null;
}

/**
 * Image component that renders inline terminal images.
 */
export class Image implements Component {
  _parent: import("../component.js").Container | null = null;
  private data: Buffer;
  private options: TerminalImageOptions;
  private protocol: 'kitty' | 'iterm2' | null;
  private fallbackText: string;

  constructor(
    data: Buffer,
    options: TerminalImageOptions & { fallbackText?: string } = {}
  ) {
    this.data = data;
    this.options = {
      width: options.width,
      height: options.height,
      preserveAspectRatio: options.preserveAspectRatio ?? true,
    };
    this.protocol = detectImageProtocol();
    this.fallbackText = options.fallbackText || '[Image]';
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
    if (!this.protocol) {
      return [this.fallbackText];
    }

    if (this.protocol === 'kitty') {
      return this.renderKitty();
    }

    return this.renderITerm2();
  }

  private renderKitty(): string[] {
    const transferId = Math.floor(Math.random() * 0xffff);
    const sil = this.options.preserveAspectRatio ? 's=1' : 's=0';
    const width = this.options.width ? `w=${this.options.width}` : '';
    const height = this.options.height ? `h=${this.options.height}` : '';
    const params = [transferId.toString(16), 'a=T', sil, width, height].filter(Boolean).join(';');

    const imageSeq = `\x1b_G${params},t=0;\x1b\\\\`;
    const dataSeq = Buffer.from(this.data.toString('base64'), 'utf-8').toString();

    // Split base64 into chunks
    const chunkSize = 4096;
    const lines: string[] = [];

    // First line with image intro
    lines.push(imageSeq);

    // Data chunks
    for (let i = 0; i < dataSeq.length; i += chunkSize) {
      const chunk = dataSeq.slice(i, i + chunkSize);
      const qmark = i + chunkSize < dataSeq.length ? ',' : '';
      lines.push(`\x1b_G${qmark}${chunk}`);
    }

    // Close
    lines[lines.length - 1] += '\x1b\\\\';

    return lines;
  }

  private renderITerm2(): string[] {
    const base64 = this.data.toString('base64');
    const width = this.options.width ? `${this.options.width}px` : '';
    const height = this.options.height ? `${this.options.height}px` : '';

    const seq = `\x1b]1337;File=inline=1;size=${base64.length};width=${width};height=${height}:${base64}\x07`;
    return [seq];
  }
}
