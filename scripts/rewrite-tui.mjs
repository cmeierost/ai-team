import * as fs from 'node:fs';

const content = `/**
 * Main TUI class with differential rendering.
 * Based on pi-tui architecture.
 */

import { Terminal } from './terminal.js';
import { Component, Container, CURSOR_MARKER, isFocusable } from './component.js';
import { visibleWidth } from './utils.js';

/**
 * TUI — Terminal UI manager with differential rendering.
 * Extends Container so you can add children directly.
 */
export class TUI extends Container {
  private readonly terminal: Terminal;
  private previousLines: string[] = [];
  private previousWidth = 0;
  private previousHeight = 0;
  private focusedComponent: Component | null = null;
  private renderRequested = false;
  private renderTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(terminal: Terminal) {
    super();
    this.terminal = terminal;
  }

  start(): void {
    this.stopped = false;
    this.terminal.start(
      (data) => this.handleInput(data),
      () => this.requestRender()
    );
    this.terminal.hideCursor();
    this.requestRender(true);
  }

  stop(): void {
    this.stopped = true;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    if (this.previousLines.length > 0) {
      this.terminal.write('\\x1b[' + this.previousLines.length + 'B\\r\\n');
    }
    this.terminal.showCursor();
    this.terminal.stop();
  }

  requestRender(force = false): void {
    if (force) {
      this.previousLines = [];
      this.previousWidth = -1;
      this.previousHeight = -1;
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
        this.renderTimer = undefined;
      }
      this.renderRequested = true;
      process.nextTick(() => {
        if (this.stopped || !this.renderRequested) return;
        this.renderRequested = false;
        this.doRender();
      });
      return;
    }
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => {
      if (this.stopped || !this.renderRequested) return;
      this.renderRequested = false;
      this.doRender();
    });
  }

  setFocused(component: Component | null): void {
    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = component;
    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = true;
    }
    this.requestRender();
  }

  invalidate(): void {
    super.invalidate();
    this.requestRender(true);
  }

  private doRender(): void {
    if (this.stopped) return;
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
    const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;

    let newLines = this.render(width);

    const cursorPos = this.extractCursorPosition(newLines);

    for (let i = 0; i < newLines.length; i++) {
      const idx = newLines[i].indexOf(CURSOR_MARKER);
      if (idx !== -1) {
        newLines[i] = newLines[i].slice(0, idx) + newLines[i].slice(idx + CURSOR_MARKER.length);
      }
    }

    if (this.previousLines.length === 0 && !widthChanged && !heightChanged) {
      this.writeLines(newLines, width, height);
      this.positionHardwareCursor(cursorPos);
      this.previousLines = newLines;
      this.previousWidth = width;
      this.previousHeight = height;
      return;
    }

    if (widthChanged || heightChanged) {
      this.writeLines(newLines, width, height, true);
      this.positionHardwareCursor(cursorPos);
      this.previousLines = newLines;
      this.previousWidth = width;
      this.previousHeight = height;
      return;
    }

    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(newLines.length, this.previousLines.length);
    for (let i = 0; i < maxLines; i++) {
      const oldLine = i < this.previousLines.length ? this.previousLines[i] : '';
      const newLine = i < newLines.length ? newLines[i] : '';
      if (oldLine !== newLine) {
        if (firstChanged === -1) firstChanged = i;
        lastChanged = i;
      }
    }

    if (firstChanged === -1) {
      this.positionHardwareCursor(cursorPos);
      return;
    }

    this.writeDiff(newLines, firstChanged, lastChanged, width, height);
    this.positionHardwareCursor(cursorPos);
    this.previousLines = newLines;
    this.previousWidth = width;
    this.previousHeight = height;
  }

  private writeLines(lines: string[], _width: number, height: number, clear = false): void {
    let buffer = '\\x1b[?2026h';
    if (clear) {
      buffer += '\\x1b[2J\\x1b[H';
    } else {
      buffer += '\\x1b[H';
    }

    for (let i = 0; i < lines.length; i++) {
      if (i > 0) buffer += '\\r\\n';
      buffer += lines[i];
      buffer += '\\x1b[K';
    }

    for (let i = lines.length; i < height; i++) {
      buffer += '\\r\\n\\x1b[K';
    }

    buffer += '\\x1b[?2026l';
    this.terminal.write(buffer);
  }

  private writeDiff(lines: string[], firstChanged: number, lastChanged: number, _width: number, _height: number): void {
    let buffer = '\\x1b[?2026h';

    if (firstChanged > 0) {
      buffer += '\\x1b[' + (firstChanged + 1) + 'H';
    } else {
      buffer += '\\x1b[H';
    }

    const renderEnd = Math.min(lastChanged, lines.length - 1);
    for (let i = firstChanged; i <= renderEnd; i++) {
      if (i > firstChanged) buffer += '\\r\\n';
      buffer += '\\x1b[2K';
      buffer += lines[i];
      buffer += '\\x1b[K';
    }

    if (this.previousLines.length > lines.length) {
      const extraLines = this.previousLines.length - lines.length;
      for (let i = 0; i < extraLines; i++) {
        buffer += '\\r\\n\\x1b[2K';
      }
      if (extraLines > 0) {
        buffer += '\\x1b[' + extraLines + 'A';
      }
    }

    buffer += '\\x1b[?2026l';
    this.terminal.write(buffer);
  }

  private extractCursorPosition(lines: string[]): { row: number; col: number } | null {
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].indexOf(CURSOR_MARKER);
      if (idx !== -1) {
        const beforeMarker = lines[i].slice(0, idx);
        const col = visibleWidth(beforeMarker);
        return { row: i, col };
      }
    }
    return null;
  }

  private positionHardwareCursor(cursorPos: { row: number; col: number } | null): void {
    if (!cursorPos) {
      this.terminal.hideCursor();
      return;
    }
    this.terminal.write('\\x1b[' + (cursorPos.row + 1) + ';' + (cursorPos.col + 1) + 'H');
  }

  private handleInput(data: string): void {
    if (this.focusedComponent?.handleInput) {
      this.focusedComponent.handleInput(data);
      this.requestRender();
    }
  }
}
`;

fs.writeFileSync('c:\\Projects\\ai-team\\packages\\tui\\src\\tui.ts', content);
console.log('Written tui.ts');
