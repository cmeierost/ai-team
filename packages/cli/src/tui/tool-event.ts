/**
 * Tool event component — renders a tool call event.
 */

import { Component } from '@ai-team/tui';

/**
 * Tool event — displays a tool call with input/output.
 */
export class ToolEvent implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private toolName: string;
  private input: unknown;
  private output?: unknown;
  private phase?: string;
  private collapsed = false;
  private invalidated = true;
  private cachedLines?: string[];

  constructor(toolName: string, input: unknown, output?: unknown, phase?: string) {
    this.toolName = toolName;
    this.input = input;
    this.output = output;
    this.phase = phase;
  }

  update(input: unknown, output: unknown, phase?: string): void {
    if (input !== undefined) this.input = input;
    if (output !== undefined) this.output = output;
    this.phase = phase ?? this.phase;
    this.invalidated = true;
    this.cachedLines = undefined;
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.invalidated = true;
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
    this.invalidated = true;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.invalidated) {
      this.cachedLines = this.buildLines(width);
      this.invalidated = false;
    }
    return this.cachedLines ?? [];
  }

  private buildLines(width: number): string[] {
    const result: string[] = [];
    const header = this.buildHeader();
    result.push(header);

    if (!this.collapsed) {
      // Input
      const inputStr = this.formatValue(this.input);
      const inputLines = this.wrapBlock(`Input:`, inputStr, width);
      result.push(...inputLines);

      // Output
      if (this.output !== undefined) {
        const outputStr = this.formatValue(this.output);
        const outputLines = this.wrapBlock(`Output:`, outputStr, width);
        result.push(...outputLines);
      }
    }

    return result;
  }

  private buildHeader(): string {
    const indicator = this.collapsed ? '▶' : '▼';
    const dimStyle = '\x1b[2m';
    const reset = '\x1b[0m';
    const phase = this.phase ? ` [${this.phase}]` : '';
    return `${dimStyle}${indicator} ${this.toolName}${phase}${reset}`;
  }

  private formatValue(value: unknown): string {
    if (value === undefined || value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private wrapBlock(_label: string, content: string, width: number): string[] {
    const lines: string[] = [`\x1b[2m  ${_label}\x1b[0m`];
    const dimStyle = '\x1b[2m';
    const reset = '\x1b[0m';

    const contentLines = content.split('\n');
    for (const line of contentLines) {
      const wrapped = this.wrapLine(`  ${line}`, width);
      lines.push(...wrapped.map(l => `${dimStyle}${l}${reset}`));
    }

    return lines;
  }

  private wrapLine(text: string, maxWidth: number): string[] {
    if (text.length <= maxWidth) return [text];

    const result: string[] = [];
    const words = text.split(' ');
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (test.length <= maxWidth || !current) {
        current = test;
      } else {
        result.push(current);
        current = word;
      }
    }

    if (current) result.push(current);
    return result;
  }
}
