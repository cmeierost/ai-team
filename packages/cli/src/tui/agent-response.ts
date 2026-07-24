/**
 * Agent response component — renders a block of agent text.
 */

import {
  Component,
  Markdown,
  TextOptions,
  truncateToWidth,
  visibleWidth,
} from '@ai-team/tui';
import {
  AgentDisplayInfo,
  agentMessageBackground,
  agentTextOptions,
} from './agent-color.js';

/**
 * Agent response — a block of text from an agent.
 */
export class AgentResponse implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private agent: AgentDisplayInfo;
  private developerName?: string;
  private recipientAgent?: AgentDisplayInfo;
  private readonly prefix: string;
  private text = '';
  private invalidated = true;
  private cachedLines?: string[];

  constructor(agent: AgentDisplayInfo, developerName?: string, prefix = '  ') {
    this.agent = agent;
    this.developerName = developerName?.trim() || undefined;
    this.prefix = prefix;
  }

  setIdentity(agent: AgentDisplayInfo, developerName?: string): void {
    this.agent = agent;
    this.developerName = developerName?.trim() || undefined;
    this.invalidate();
  }

  /** Use an agent identity for a handoff recipient instead of the developer label. */
  setRecipientIdentity(agent: AgentDisplayInfo): void {
    this.recipientAgent = agent;
    this.developerName = undefined;
    this.invalidate();
  }

  /**
   * Append text to the response.
   */
  append(text: string): void {
    this.text += text;
    this.invalidated = true;
  }

  /**
   * Set the complete text.
   */
  setText(text: string): void {
    this.text = text;
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
    const modelSuffix = this.formatModelSuffix(this.agent);
    const recipient = this.recipientAgent
      ? `${this.buildStyle(agentTextOptions(this.recipientAgent))}\x1b[1m → ${this.recipientAgent.name}${this.formatModelSuffix(this.recipientAgent)}:\x1b[22m`
      : this.developerName
        ? ` → ${this.developerName}:`
        : ':';
    const opts = agentTextOptions(this.agent);
    const colorStyle = this.buildStyle(opts);
    const headerStyle = `${colorStyle}\x1b[1m`;
    const reset = '\x1b[0m';
    const result: string[] = [
      `${headerStyle}${this.agent.name}${modelSuffix}${recipient}${reset}`,
    ];

    const markdown = new Markdown(this.text, {
      defaultColor:
        opts?.fg && typeof opts.fg === 'object' && 'r' in opts.fg
          ? opts.fg
          : undefined,
    });
    // Reserve the message surface's leading and trailing padding before
    // Markdown wraps. Otherwise a full body row is truncated by two columns
    // when the background is applied, silently dropping response characters.
    const bodyWidth = Math.max(1, width - this.prefix.length - 2);
    result.push(...markdown.render(bodyWidth).map((line) => `${this.prefix}${line}`));

    return this.applyMessageBackground(result, width);
  }

  private buildStyle(opts: TextOptions | undefined): string {
    if (!opts) return '';

    let style = '';

    if (opts.fg && typeof opts.fg === 'object' && 'r' in opts.fg) {
      style += `\x1b[38;2;${opts.fg.r};${opts.fg.g};${opts.fg.b}m`;
    }

    return style;
  }

  private formatModelSuffix(agent: AgentDisplayInfo): string {
    return agent.model ? ` \x1b[2m(${agent.model})\x1b[22m` : '';
  }

  private applyMessageBackground(lines: string[], width: number): string[] {
    const background = agentMessageBackground(this.agent);
    const backgroundStyle =
      `\x1b[48;2;${background.r};${background.g};${background.b}m`;
    const reset = '\x1b[0m';

    return lines.map((line) => {
      // Markdown spans reset their own styles; immediately restore the block
      // background so inline formatting cannot punch holes in the surface.
      const withPersistentBackground = line.replaceAll(
        reset,
        `${reset}${backgroundStyle}`
      );
      const paddedContent = truncateToWidth(` ${withPersistentBackground}`, Math.max(1, width - 1));
      const padding = ' '.repeat(Math.max(0, width - visibleWidth(paddedContent)));
      return `${backgroundStyle}${paddedContent}${padding}${reset}`;
    });
  }
}

