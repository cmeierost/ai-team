/**
 * Input handling utilities for TUI.
 */

import { decodePrintableKey, matchesKey } from './keys.js';

/**
 * Bracketed paste state — captures multi-line paste from terminal.
 */
export class BracketedPaste {
  private static readonly START_MARKER = '\x1b[200~';
  private static readonly END_MARKER = '\x1b[201~';
  private buffer = '';
  private capturing = false;

  /**
   * Process raw input data. Returns the pasted content if a paste was completed,
   * or the remaining input to process otherwise.
   */
  process(data: string): { pasted?: string; remaining?: string } {
    if (this.capturing) {
      const combined = this.buffer + data;
      const endIndex = combined.indexOf(BracketedPaste.END_MARKER);

      if (endIndex !== -1) {
        this.capturing = false;
        const pasted = combined.slice(0, endIndex);
        const remaining = combined.slice(endIndex + BracketedPaste.END_MARKER.length);
        this.buffer = '';
        return remaining ? { pasted, remaining } : { pasted };
      }

      this.buffer = combined;
      return {};
    }

    const startIndex = data.indexOf(BracketedPaste.START_MARKER);
    if (startIndex !== -1) {
      const before = data.slice(0, startIndex);
      const after = data.slice(startIndex + BracketedPaste.START_MARKER.length);
      this.capturing = true;
      this.buffer = '';
      const result = this.process(after);
      const remaining = before + (result.remaining ?? '');
      return remaining ? { ...result, remaining } : result;
    }

    return { remaining: data };
  }

  /** Reset paste buffer (e.g. on escape) */
  reset(): void {
    this.capturing = false;
    this.buffer = '';
  }
}

/**
 * Simple line editor for single-line input.
 */
export class LineEditor {
  private _value = '';
  private cursor = 0;

  constructor(initial = '') {
    this._value = initial;
    this.cursor = initial.length;
  }

  get value(): string {
    return this._value;
  }

  get cursorPos(): number {
    return this.cursor;
  }

  /** Handle input from the terminal */
  handleInput(data: string): boolean {
    const printable = decodePrintableKey(data);
    if (printable) {
      this.insert(printable);
      return true;
    }

    if (matchesKey(data, 'backspace')) {
      this.backspace();
      return true;
    }

    if (matchesKey(data, 'delete')) {
      this.delete();
      return true;
    }

    if (matchesKey(data, 'left')) {
      this.moveLeft();
      return true;
    }

    if (matchesKey(data, 'right')) {
      this.moveRight();
      return true;
    }

    if (matchesKey(data, 'up')) {
      this.moveVertical(-1);
      return true;
    }

    if (matchesKey(data, 'down')) {
      this.moveVertical(1);
      return true;
    }

    if (matchesKey(data, 'home')) {
      this.moveToStart();
      return true;
    }

    if (matchesKey(data, 'end')) {
      this.moveToEnd();
      return true;
    }

    if (matchesKey(data, 'ctrl+a')) {
      this.moveToStart();
      return true;
    }

    if (matchesKey(data, 'ctrl+e')) {
      this.moveToEnd();
      return true;
    }

    if (matchesKey(data, 'ctrl+d')) {
      this.delete();
      return true;
    }

    if (matchesKey(data, 'ctrl+w')) {
      this.deleteWordBack();
      return true;
    }

    if (matchesKey(data, 'ctrl+k')) {
      this.killToEnd();
      return true;
    }

    return false;
  }

  private insert(ch: string): void {
    this._value = this._value.slice(0, this.cursor) + ch + this._value.slice(this.cursor);
    this.cursor += ch.length;
  }

  private backspace(): void {
    if (this.cursor === 0) return;
    const previous = previousCodePointIndex(this._value, this.cursor);
    this._value = this._value.slice(0, previous) + this._value.slice(this.cursor);
    this.cursor = previous;
  }

  insertText(text: string): void {
    this.insert(text);
  }

  private delete(): void {
    if (this.cursor >= this._value.length) return;
    const next = nextCodePointIndex(this._value, this.cursor);
    this._value = this._value.slice(0, this.cursor) + this._value.slice(next);
  }

  private moveLeft(): void {
    this.cursor = previousCodePointIndex(this._value, this.cursor);
  }

  private moveRight(): void {
    this.cursor = nextCodePointIndex(this._value, this.cursor);
  }

  private moveToStart(): void {
    this.cursor = 0;
  }

  private moveToEnd(): void {
    this.cursor = this._value.length;
  }

  private deleteWordBack(): void {
    const wordEnd = this.cursor;
    let wordStart = this.cursor;

    // Skip whitespace
    while (wordStart > 0 && /\s/.test(this._value[wordStart - 1])) {
      wordStart--;
    }

    // Skip word
    while (wordStart > 0 && !/\s/.test(this._value[wordStart - 1])) {
      wordStart--;
    }

    this._value = this._value.slice(0, wordStart) + this._value.slice(wordEnd);
    this.cursor = wordStart;
  }

  private killToEnd(): void {
    this._value = this._value.slice(0, this.cursor);
  }

  /** Reset the editor value */
  reset(value = ''): void {
    this._value = value;
    this.cursor = value.length;
  }

  private moveVertical(direction: -1 | 1): void {
    const lineStart = this._value.lastIndexOf('\n', Math.max(0, this.cursor - 1)) + 1;
    const lineEndIndex = this._value.indexOf('\n', this.cursor);
    const lineEnd = lineEndIndex === -1 ? this._value.length : lineEndIndex;
    const column = Array.from(this._value.slice(lineStart, this.cursor)).length;

    if (direction < 0) {
      if (lineStart === 0) return;
      const targetEnd = lineStart - 1;
      const targetStart = this._value.lastIndexOf('\n', Math.max(0, targetEnd - 1)) + 1;
      this.cursor = targetStart + codeUnitLengthAtMost(
        this._value.slice(targetStart, targetEnd),
        column
      );
      return;
    }

    if (lineEnd === this._value.length) return;
    const targetStart = lineEnd + 1;
    const nextBreak = this._value.indexOf('\n', targetStart);
    const targetEnd = nextBreak === -1 ? this._value.length : nextBreak;
    this.cursor = targetStart + codeUnitLengthAtMost(
      this._value.slice(targetStart, targetEnd),
      column
    );
  }
}

function codeUnitLengthAtMost(value: string, codePoints: number): number {
  return Array.from(value).slice(0, codePoints).join('').length;
}

function previousCodePointIndex(value: string, index: number): number {
  if (index <= 0) return 0;
  const previousCodeUnit = value.charCodeAt(index - 1);
  if (previousCodeUnit >= 0xdc00 && previousCodeUnit <= 0xdfff && index >= 2) {
    const leadingCodeUnit = value.charCodeAt(index - 2);
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) {
      return index - 2;
    }
  }
  return index - 1;
}

function nextCodePointIndex(value: string, index: number): number {
  if (index >= value.length) return value.length;
  const codePoint = value.codePointAt(index);
  return Math.min(value.length, index + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1));
}
