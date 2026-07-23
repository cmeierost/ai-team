import { describe, expect, it } from 'vitest';
import { Container, type Component } from './component.js';
import type { Terminal } from './terminal.js';
import { TUI } from './tui.js';

class FakeTerminal implements Terminal {
  columns = 40;
  rows = 10;
  writes: string[] = [];
  showCursorCalls = 0;
  private onInput?: (data: string) => void;
  private onResize?: () => void;

  write(data: string): void {
    this.writes.push(data);
  }

  hideCursor(): void {}
  showCursor(): void { this.showCursorCalls++; }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.onInput = onInput;
    this.onResize = onResize;
  }

  stop(): void {}

  input(data: string): void {
    this.onInput?.(data);
  }

  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.onResize?.();
  }

  clearWrites(): void {
    this.writes = [];
  }
}

class MutableComponent implements Component {
  _parent: Container | null = null;
  lines: string[] = [];
  invalidations = 0;
  renderedWidth = 0;

  render(width: number): string[] {
    this.renderedWidth = width;
    return this.lines;
  }

  invalidate(): void {
    this.invalidations++;
  }

  remove(): void {
    this._parent?.removeChild(this);
  }
}

async function flushRender(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('TUI rendering', () => {
  it('uses differential rendering after component invalidation', async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const component = new MutableComponent();
    component.lines = ['first'];
    tui.addChild(component);

    tui.start();
    await flushRender();
    terminal.clearWrites();

    component.lines = ['second'];
    tui.invalidate();
    await flushRender();

    const output = terminal.writes.join('');
    expect(output).toContain('second');
    expect(output).not.toContain('\x1b[2J');
    tui.stop();
  });

  it('starts a differential row repaint explicitly at column one', async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const component = new MutableComponent();
    component.lines = ['stable', 'old'];
    tui.addChild(component);
    tui.start();
    await flushRender();
    terminal.clearWrites();

    component.lines = ['stable', 'new'];
    tui.invalidate();
    await flushRender();

    expect(terminal.writes.join('')).toContain('\x1b[2;1H');
    tui.stop();
  });

  it('repaints a complete terminal-height frame instead of applying an unsafe partial diff', async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const component = new MutableComponent();
    component.lines = Array.from(
      { length: terminal.rows },
      (_, index) => index === terminal.rows - 1 ? 'footer' : `old-${index}`
    );
    tui.addChild(component);
    tui.start();
    await flushRender();
    terminal.clearWrites();

    component.lines = component.lines.map((line, index) =>
      index === 2 ? 'streamed-agent-line' : line
    );
    tui.invalidate();
    await flushRender();

    const output = terminal.writes.join('');
    expect(output).toContain('\x1b[H');
    expect(output).toContain('old-0');
    expect(output).toContain('streamed-agent-line');
    expect(output).toContain('footer');
    tui.stop();
  });

  it('coalesces multiple render requests into one terminal write', async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const component = new MutableComponent();
    component.lines = ['first'];
    tui.addChild(component);
    tui.start();
    await flushRender();
    terminal.clearWrites();

    component.lines = ['second'];
    tui.requestRender();
    tui.requestRender();
    tui.requestRender();
    await flushRender();

    expect(terminal.writes).toHaveLength(1);
    tui.stop();
  });

  it('routes input only to the focused component', async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const received: string[] = [];
    const component = new MutableComponent();
    component.handleInput = (data) => received.push(data);
    tui.addChild(component);
    tui.start();
    await flushRender();

    terminal.input('a');
    expect(received).toEqual([]);

    tui.setFocused(component);
    terminal.input('b');
    expect(received).toEqual(['b']);
    tui.stop();
  });

  it('invalidates component caches when terminal dimensions change', async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const component = new MutableComponent();
    component.lines = ['content'];
    tui.addChild(component);
    tui.start();
    await flushRender();
    const initialInvalidations = component.invalidations;

    terminal.resize(60, 12);
    await flushRender();

    expect(component.invalidations).toBeGreaterThan(initialInvalidations);
    tui.stop();
  });

  it('disables auto-wrap while painting exact-width rows', async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const component = new MutableComponent();
    component.lines = ['x'.repeat(terminal.columns), 'footer'.padEnd(terminal.columns)];
    tui.addChild(component);

    tui.start();
    await flushRender();

    const output = terminal.writes.join('');
    expect(output.indexOf('\x1b[?7l')).toBeLessThan(output.indexOf('x'.repeat(40)));
    expect(output.indexOf('\x1b[?7h')).toBeGreaterThan(output.indexOf('footer'));
    tui.stop();
  });

  it('reserves the terminal wrap-trigger column from component layout', async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const component = new MutableComponent();
    component.lines = ['message'];
    tui.addChild(component);

    tui.start();
    await flushRender();

    expect(component.renderedWidth).toBe(terminal.columns - 1);
    tui.stop();
  });

  it('shows the hardware cursor when a focused component emits a cursor marker', async () => {
    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const component = new MutableComponent();
    component.lines = [`input${'\x1b_pi:c\x07'}`];
    component.handleInput = () => {};
    tui.addChild(component);
    tui.setFocused(component);

    tui.start();
    await flushRender();

    expect(terminal.showCursorCalls).toBeGreaterThan(0);
    tui.stop();
  });

  it('commits overflowing inline rows to native terminal scrollback', async () => {
    const terminal = new FakeTerminal();
    terminal.rows = 4;
    const tui = new TUI(terminal, { inline: true });
    const component = new MutableComponent();
    component.lines = ['one', 'two', 'three', 'four', 'five', 'six'];
    tui.addChild(component);

    tui.start();
    await flushRender();
    expect(terminal.writes.join('')).toContain('one');
    expect(terminal.writes.join('')).toContain('six');

    terminal.clearWrites();
    component.lines.push('seven');
    tui.invalidate();
    await flushRender();

    const output = terminal.writes.join('');
    expect(output).toContain('\x1b[4;1H\r\n');
    expect(output).toContain('seven');

    terminal.clearWrites();
    component.lines.push('eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen');
    tui.invalidate();
    await flushRender();
    expect(terminal.writes.join('')).toContain('ten');
    expect(terminal.writes.join('')).toContain('thirteen');
    tui.stop();
  });

  it('repaints an inline frame before committing content inserted above fixed footer rows', async () => {
    const terminal = new FakeTerminal();
    terminal.rows = 4;
    const tui = new TUI(terminal, { inline: true });
    const component = new MutableComponent();
    component.lines = ['message-1', 'message-2', 'prompt', 'footer'];
    tui.addChild(component);

    tui.start();
    await flushRender();
    terminal.clearWrites();

    component.lines = [
      'message-1',
      'message-2',
      'tool-1',
      'tool-2',
      'tool-3',
      'tool-4',
      'prompt',
      'footer',
    ];
    tui.invalidate();
    await flushRender();

    const output = terminal.writes.join('');
    const firstScroll = output.indexOf('\x1b[4;1H\r\n');
    expect(firstScroll).toBeGreaterThan(-1);
    expect(output).toContain('tool-1');
    expect(output).toContain('tool-2');
    expect(output.indexOf('tool-1')).toBeLessThan(firstScroll);
    expect(output.indexOf('tool-2')).toBeLessThan(firstScroll);
    tui.stop();
  });
});
