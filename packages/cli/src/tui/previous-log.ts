/**
 * Previous log component — renders log messages from previous turns.
 */

import { Component } from '@ai-team/tui';

/**
 * Log message with timestamp and level.
 */
export interface LogMessage {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
}

/**
 * Previous log — renders log messages from previous turns.
 */
export class PreviousLog implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private messages: LogMessage[] = [];
  private invalidated = true;
  private cachedLines?: string[];

  constructor(messages: LogMessage[] = []) {
    this.messages = messages;
  }

  /**
   * Add a log message.
   */
  addMessage(level: LogMessage['level'], message: string): void {
    this.messages.push({ level, message, timestamp: Date.now() });
    this.invalidated = true;
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.messages = [];
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

  render(_width: number): string[] {
    if (this.invalidated) {
      this.cachedLines = this.buildLines();
      this.invalidated = false;
    }
    return this.cachedLines ?? [];
  }

  private buildLines(): string[] {
    if (this.messages.length === 0) return [];

    const result: string[] = [];
    const dimStyle = '\x1b[2m';
    const reset = '\x1b[0m';

    for (const msg of this.messages) {
      const levelStyle = this.levelStyle(msg.level);
      const level = msg.level.toUpperCase().padEnd(5);
      result.push(`${dimStyle}${levelStyle}[${level}]${reset} ${dimStyle}${msg.message}${reset}`);
    }

    return result;
  }

  private levelStyle(level: LogMessage['level']): string {
    switch (level) {
      case 'error': return '\x1b[31m';
      case 'warn': return '\x1b[33m';
      case 'debug': return '\x1b[36m';
      case 'info': return '\x1b[32m';
    }
  }
}
