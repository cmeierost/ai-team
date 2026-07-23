/**
 * Header bar component — always visible at the top.
 *
 * Shows: [Workflow: {name}]  Agent: {agentName} ({model})
 * Styled with the current agent's color.
 */

import { Component, TextOptions, truncateToWidth, visibleWidth } from '@ai-team/tui';
import { AgentDisplayInfo, agentTextOptions } from './agent-color.js';

/**
 * Header bar state.
 */
export interface HeaderBarState {
  workflowName?: string;
  agent?: AgentDisplayInfo;
  status?: string;
}

/**
 * Header bar — always visible at the top of the TUI.
 */
export class HeaderBar implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private readonly state: HeaderBarState = {};

  setState(state: Partial<HeaderBarState>): void {
    Object.assign(this.state, state);
  }

  setWorkflowName(name: string | undefined): void {
    this.state.workflowName = name;
  }

  setAgent(agent: AgentDisplayInfo | undefined): void {
    this.state.agent = agent;
  }

  setStatus(status: string | undefined): void {
    this.state.status = status;
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
    // No-op
  }

  render(width: number): string[] {
    const parts: string[] = [];

    // Workflow name
    if (this.state.workflowName) {
      parts.push(`[Workflow: ${this.state.workflowName}]`);
    }

    // Agent info
    if (this.state.agent) {
      const agentLabel = this.state.agent.model
        ? `${this.state.agent.name} (${this.state.agent.model})`
        : this.state.agent.name;
      parts.push(`Agent: ${agentLabel}`);
    }

    // Status
    if (this.state.status) {
      parts.push(this.state.status);
    }

    if (parts.length === 0) return [];

    const text = parts.join('  ');
    const opts = this.state.agent
      ? agentTextOptions(this.state.agent) ?? { bold: true }
      : { bold: true };

    // Build styled line manually
    const style = this.buildStyle(opts);
    const line = truncateToWidth(`${style}${text}\x1b[0m`, width);

    // Pad to width
    const visible = visibleWidth(line);
    const padding = Math.max(0, width - visible);
    return [line + ' '.repeat(padding)];
  }

  private buildStyle(opts: TextOptions): string {
    let style = '';

    if (opts.bold) style += '\x1b[1m';

    if (opts.fg && typeof opts.fg === 'object' && 'r' in opts.fg) {
      style += `\x1b[38;2;${opts.fg.r};${opts.fg.g};${opts.fg.b}m`;
    }

    return style;
  }
}
