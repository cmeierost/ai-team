/**
 * Terminal abstraction for TUI rendering.
 */

import { stdin as input, stdout as output } from 'node:process';
import type { ITerminal } from '@ai-team/core';

/**
 * Terminal interface — abstracts stdout/stdin for TUI rendering.
 */
export type Terminal = ITerminal;

/**
 * ProcessTerminal — real terminal implementation using process stdin/stdout.
 */
export class ProcessTerminal implements ITerminal {
  private _columns = 80;
  private _rows = 24;
  private rawMode = false;
  private handlersInstalled = false;
  private onInput?: (data: string) => void;
  private onResize?: () => void;
  private readonly handleData = (data: Buffer | string) => {
    this.onInput?.(data.toString());
  };
  private readonly handleResize = () => {
    this.updateSize();
    this.onResize?.();
  };

  get columns(): number {
    return this._columns;
  }

  get rows(): number {
    return this._rows;
  }

  write(data: string): void {
    output.write(data);
  }

  hideCursor(): void {
    output.write('\x1b[?25l');
  }

  showCursor(): void {
    output.write('\x1b[?25h');
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.onInput = onInput;
    this.onResize = onResize;

    // Enable raw mode
    if (input.isTTY) {
      input.setRawMode(true);
      this.rawMode = true;
    }

    // Enable bracketed paste mode
    output.write('\x1b[?2004h');

    // Query terminal size
    this.updateSize();

    if (!this.handlersInstalled) {
      // A previous TUI lifecycle may have released stdin so Node can return
      // to its caller. Re-reference it while this interactive session is live.
      input.ref();
      input.resume();
      input.on('data', this.handleData);
      output.on('resize', this.handleResize);

      this.handlersInstalled = true;
    }
  }

  stop(): void {
    // Restore raw mode
    if (this.rawMode && input.isTTY) {
      input.setRawMode(false);
      this.rawMode = false;
    }

    // Disable bracketed paste
    output.write('\x1b[?2004l');

    // Ensure any mouse modes are restored if a caller enabled them.
    output.write('\x1b[?1006l\x1b[?1003l');

    if (this.handlersInstalled) {
      input.off('data', this.handleData);
      output.off('resize', this.handleResize);
      input.pause();
      // On Windows/ConPTY, pause() alone can leave the TTY handle referenced
      // and keep Node alive after /exit. Explicitly release it once all input
      // listeners have been removed.
      input.unref();
      this.handlersInstalled = false;
    }

    this.onInput = undefined;
    this.onResize = undefined;
  }

  private updateSize(): void {
    if (output.columns && output.rows) {
      this._columns = output.columns;
      this._rows = output.rows;
    }
  }
}
