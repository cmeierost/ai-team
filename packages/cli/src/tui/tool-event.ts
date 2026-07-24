/**
 * Tool event component — renders a tool call event.
 */

import { Component, sliceByColumn, visibleWidth } from '@ai-team/tui';

export interface ToolEventOptions {
  maxInputLines?: number;
  maxOutputLines?: number;
}

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

  constructor(
    toolName: string,
    input: unknown,
    output?: unknown,
    phase?: string,
    private readonly options: ToolEventOptions = {}
  ) {
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
      if (this.input !== undefined) {
        const inputStr = this.formatValue(this.input);
        const inputLines = this.wrapBlock(
          'Input:',
          inputStr,
          width,
          this.options.maxInputLines
        );
        result.push(...inputLines);
      }

      if (this.output !== undefined) {
        const outputStr = this.formatValue(this.output);
        const outputLines = this.wrapBlock(
          'Output:',
          outputStr,
          width,
          this.options.maxOutputLines
        );
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

  private wrapBlock(
    label: string,
    content: string,
    width: number,
    maxContentLines?: number
  ): string[] {
    const lines: string[] = [`\x1b[2m  ${label}\x1b[0m`];
    const dimStyle = '\x1b[2m';
    const reset = '\x1b[0m';

    const contentLines = content
      .split('\n')
      .flatMap((line) => this.wrapLine(`  ${line}`, width));
    const visibleLines = maxContentLines === undefined
      ? contentLines
      : contentLines.slice(0, maxContentLines);
    lines.push(...visibleLines.map((line) => `${dimStyle}${line}${reset}`));

    const omittedLines = contentLines.length - visibleLines.length;
    if (omittedLines > 0) {
      lines.push(`${dimStyle}  … ${omittedLines} more lines${reset}`);
    }

    return lines;
  }

  private wrapLine(text: string, maxWidth: number): string[] {
    const safeWidth = Math.max(1, maxWidth);
    const sourceWidth = visibleWidth(text);
    if (sourceWidth <= safeWidth) return [text];
    const result: string[] = [];
    let offset = 0;

    while (offset < sourceWidth) {
      const remainingWidth = sourceWidth - offset;
      if (remainingWidth <= safeWidth) {
        result.push(sliceByColumn(text, offset, remainingWidth));
        break;
      }

      const candidate = sliceByColumn(text, offset, safeWidth);
      const whitespaceRuns = Array.from(candidate.matchAll(/\s+/g)).filter(
        (match) => (match.index ?? 0) > 1
      );
      const lastWhitespace = whitespaceRuns.at(-1);
      const breakWidth = lastWhitespace
        ? visibleWidth(candidate.slice(0, lastWhitespace.index))
        : safeWidth;

      result.push(sliceByColumn(text, offset, breakWidth));
      offset += breakWidth;
      if (lastWhitespace) {
        offset += visibleWidth(lastWhitespace[0]);
      }
    }

    return result;
  }
}
