/**
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
  private inlineCommittedLines = 0;

  constructor(
    terminal: Terminal,
    private readonly options: { inline?: boolean } = {}
  ) {
    super();
    this.terminal = terminal;
  }

  // Re-export Container methods (TS inheritance issue with extends + private fields)
  addChild(component: Component): void {
    super.addChild(component);
  }

  removeChild(component: Component): void {
    component.remove();
  }

  clear(): void {
    super.clear();
  }

  remove(): void {
    super.remove();
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
    if (this.options.inline && this.previousLines.length > 0) {
      this.terminal.write(`\x1b[${this.terminal.rows};1H\r\n`);
    } else if (this.previousLines.length > 0) {
      this.terminal.write('\x1b[' + this.previousLines.length + 'B\r\n');
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
    this.requestRender();
  }

  /** Paint any pending state synchronously before a lifecycle boundary. */
  flush(): void {
    if (this.stopped) return;
    this.renderRequested = false;
    this.doRender();
  }

  private doRender(): void {
    if (this.stopped) return;
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    // Keep the terminal's final column unused. Some terminals and ConPTY
    // paths wrap immediately when it is painted even while DECAWM is disabled,
    // which creates extra physical rows and scrolls over bottom-anchored UI.
    const renderWidth = Math.max(1, width - 1);
    const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
    const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;

    if (widthChanged || heightChanged) {
      super.invalidate();
    }

    let newLines = this.render(renderWidth);

    const cursorPos = this.extractCursorPosition(newLines);

    for (let i = 0; i < newLines.length; i++) {
      const idx = newLines[i].indexOf(CURSOR_MARKER);
      if (idx !== -1) {
        newLines[i] = newLines[i].slice(0, idx) + newLines[i].slice(idx + CURSOR_MARKER.length);
      }
    }

    if (this.options.inline) {
      this.renderInline(newLines, cursorPos, width, height, widthChanged || heightChanged);
      return;
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

    // A terminal-height root is a fixed full-screen frame (the chat layout).
    // Partial diffs are unsafe without Pi's logical cursor/viewport tracking:
    // any physical wrap or scroll invalidates absolute row assumptions and can
    // shift message starts or overwrite the bottom composer/footer. Repaint the
    // whole synchronized frame from home instead.
    if (newLines.length === height) {
      this.writeLines(newLines, width, height);
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

  /**
   * Inline mode keeps completed overflow rows in the terminal's native
   * scrollback and repaints only the current terminal-height tail.
   */
  private renderInline(
    allLines: string[],
    cursorPos: { row: number; col: number } | null,
    width: number,
    height: number,
    dimensionsChanged: boolean
  ): void {
    const commitProvider = this.children.find(
      (child) => typeof (child as { getInlineCommitCount?: unknown }).getInlineCommitCount === 'function'
    ) as { getInlineCommitCount: () => number } | undefined;
    const desiredCommitted = Math.max(
      0,
      commitProvider?.getInlineCommitCount() ?? (allLines.length - height)
    );

    if (this.previousLines.length === 0) {
      this.writeLines(allLines, width, height, dimensionsChanged);
      this.inlineCommittedLines = desiredCommitted;
    } else {
      if (dimensionsChanged) {
        // Already committed rows cannot be reflowed in terminal history.
        // Preserve them and repaint only the live tail at the new dimensions.
        this.inlineCommittedLines = Math.min(
          this.inlineCommittedLines,
          Math.max(0, allLines.length)
        );
      }
      const newlyCommitted = Math.max(0, desiredCommitted - this.inlineCommittedLines);
      if (newlyCommitted > 0) {
        // Scroll the current top row into native history, then populate the
        // newly opened bottom row. Repeating this also handles a single update
        // that adds more than one terminal-height of tool output.
        let buffer = `\x1b[${height};1H`;
        for (let index = 0; index < newlyCommitted; index++) {
          buffer += '\r\n';
          const incoming = allLines[this.inlineCommittedLines + height + index];
          if (incoming !== undefined) buffer += `${incoming}\x1b[K`;
        }
        this.terminal.write(buffer);
        this.inlineCommittedLines += newlyCommitted;
      }

      const frameStart = Math.min(this.inlineCommittedLines, allLines.length);
      const frame = allLines.slice(frameStart, frameStart + height);
      this.writeLines(frame, width, height);
    }

    const adjustedCursor = cursorPos
      ? {
          row: Math.min(
            Math.max(0, height - 1),
            Math.max(0, cursorPos.row - this.inlineCommittedLines)
          ),
          col: cursorPos.col,
        }
      : null;
    this.positionHardwareCursor(adjustedCursor);
    this.previousLines = allLines.slice(this.inlineCommittedLines, this.inlineCommittedLines + height);
    this.previousWidth = width;
    this.previousHeight = height;
  }

  private writeLines(lines: string[], _width: number, height: number, clear = false): void {
    // Disable DECAWM while painting exact-width rows. Otherwise writing the
    // final column can wrap/scroll before the following cursor command,
    // corrupting bottom-anchored composers and footers.
    let buffer = '\x1b[?2026h\x1b[?7l';
    if (clear) {
      buffer += '\x1b[2J\x1b[H';
    } else {
      buffer += '\x1b[H';
    }

    for (let i = 0; i < lines.length; i++) {
      if (i > 0) buffer += '\r\n';
      buffer += lines[i];
      buffer += '\x1b[K';
    }

    for (let i = lines.length; i < height; i++) {
      buffer += '\r\n\x1b[K';
    }

    buffer += '\x1b[?7h\x1b[?2026l';
    this.terminal.write(buffer);
  }

  private writeDiff(lines: string[], firstChanged: number, lastChanged: number, _width: number, _height: number): void {
    let buffer = '\x1b[?2026h\x1b[?7l';

    if (firstChanged > 0) {
      buffer += '\x1b[' + (firstChanged + 1) + ';1H';
    } else {
      buffer += '\x1b[H';
    }

    const renderEnd = Math.min(lastChanged, lines.length - 1);
    for (let i = firstChanged; i <= renderEnd; i++) {
      if (i > firstChanged) buffer += '\r\n';
      buffer += '\x1b[2K';
      buffer += lines[i];
      buffer += '\x1b[K';
    }

    if (this.previousLines.length > lines.length) {
      const extraLines = this.previousLines.length - lines.length;
      for (let i = 0; i < extraLines; i++) {
        buffer += '\r\n\x1b[2K';
      }
      if (extraLines > 0) {
        buffer += '\x1b[' + extraLines + 'A';
      }
    }

    buffer += '\x1b[?7h\x1b[?2026l';
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
    // TUI starts with the cursor hidden while rendering. Prompt components
    // expose a cursor marker, so make the hardware cursor visible whenever a
    // focused input position is present.
    this.terminal.showCursor();
    this.terminal.write('\x1b[' + (cursorPos.row + 1) + ';' + (cursorPos.col + 1) + 'H');
  }

  private handleInput(data: string): void {
    // Let the focused component consume mouse-wheel sequences (chat uses them
    // for transcript scrolling); other mouse events remain ignored.
    if (this.isMouseSequence(data)) {
      if (this.isMouseWheelSequence(data) && this.focusedComponent?.handleInput) {
        this.focusedComponent.handleInput(data);
        this.requestRender();
      }
      return;
    }

    // Ctrl+C handling
    if (data === '\x03') {
      process.emit('SIGINT');
      return;
    }

    if (this.focusedComponent?.handleInput) {
      this.focusedComponent.handleInput(data);
      this.requestRender();
    }
  }

  private isMouseSequence(data: string): boolean {
    // Mouse sequences: \x1b[<...M or \x1b[M... or \x1b[...M
    if (data.startsWith('\x1b[') && data.endsWith('M') && data.length > 3) {
      return true;
    }
    if (data.startsWith('\x1b[') && data.endsWith('m') && data.length > 3) {
      return true;
    }
    return false;
  }

  private isMouseWheelSequence(data: string): boolean {
    return /^\x1b\[<6[45];\d+;\d+[mM]$/.test(data);
  }
}
