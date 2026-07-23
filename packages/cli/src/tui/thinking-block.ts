import { Markdown, type Component } from '@ai-team/tui';
import type { AgentDisplayInfo } from './agent-color.js';

/**
 * Transient reasoning projection. It streams while active and collapses as
 * soon as user-visible assistant content begins.
 */
export class ThinkingBlock implements Component {
  _parent: import('@ai-team/tui').Container | null = null;
  private text = '';
  private collapsed = false;

  constructor(private readonly agent?: AgentDisplayInfo) {}

  append(chunk: string): void {
    const normalized = chunk
      .replaceAll(/\s*💭\s*/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();
    if (!normalized) return;
    const separator = this.text && !this.text.endsWith(' ') ? ' ' : '';
    this.text += `${separator}${normalized}`;
  }

  collapse(): void {
    this.collapsed = true;
  }

  remove(): void {
    this._parent?.removeChild(this);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const color = this.agent?.color;
    const foreground = color
      ? `\x1b[38;2;${color.r};${color.g};${color.b}m`
      : '';
    if (this.collapsed) {
      return [`${foreground}\x1b[2m▸ 💭 Thought process\x1b[0m`];
    }

    const prefix = `${foreground}\x1b[2m\x1b[3m💭 thinking: \x1b[0m`;
    const markdown = new Markdown(this.text, {
      defaultColor: color,
    });
    const lines = markdown.render(Math.max(1, width - 2));
    return lines.map((line, index) =>
      index === 0
        ? `${prefix}${line}`
        : `  ${foreground}\x1b[2m\x1b[3m${line}\x1b[0m`
    );
  }
}
