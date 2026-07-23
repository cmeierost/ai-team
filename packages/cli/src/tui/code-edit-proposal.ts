/**
 * Code edit proposal component — renders a code edit suggestion.
 */

import { Component } from '@ai-team/tui';

/**
 * Code edit proposal — displays a code change with accept/reject options.
 */
export class CodeEditProposal implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private filePath: string;
  private diff: string;
  private accepted?: boolean;
  private invalidated = true;
  private cachedLines?: string[];

  constructor(filePath: string, diff: string) {
    this.filePath = filePath;
    this.diff = diff;
  }

  setAccepted(accepted: boolean): void {
    this.accepted = accepted;
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

  private buildLines(_width: number): string[] {
    const result: string[] = [];
    const dimStyle = '\x1b[2m';
    const greenStyle = '\x1b[32m';
    const redStyle = '\x1b[31m';
    const yellowStyle = '\x1b[33m';
    const reset = '\x1b[0m';

    // Header
    const status = this.accepted === true ? '✓ Accepted' : this.accepted === false ? '✗ Rejected' : 'Pending';
    const statusColor = this.accepted === true ? greenStyle : this.accepted === false ? redStyle : yellowStyle;
    result.push(`${dimStyle}📝 ${this.filePath} ${statusColor}[${status}]${reset}`);

    // Diff lines
    const diffLines = this.diff.split('\n');
    for (const line of diffLines) {
      if (line.startsWith('+')) {
        result.push(`${greenStyle}${line}${reset}`);
      } else if (line.startsWith('-')) {
        result.push(`${redStyle}${line}${reset}`);
      } else if (line.startsWith('@@') || line.startsWith('@@@')) {
        result.push(`${yellowStyle}${line}${reset}`);
      } else {
        result.push(`${dimStyle}${line}${reset}`);
      }
    }

    return result;
  }
}
