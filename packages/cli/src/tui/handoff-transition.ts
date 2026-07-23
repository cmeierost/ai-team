/**
 * Handoff transition component — renders a handoff between agents.
 */

import { Component } from '@ai-team/tui';
import { AgentDisplayInfo } from './agent-color.js';
import { AgentResponse } from './agent-response.js';

/**
 * Handoff transition — displays when control passes between agents.
 */
export class HandoffTransition implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private fromAgent: AgentDisplayInfo;
  private toAgent: AgentDisplayInfo;
  private reason?: string;
  private briefing?: string;

  constructor(
    fromAgent: AgentDisplayInfo,
    toAgent: AgentDisplayInfo,
    reason?: string,
    briefing?: string
  ) {
    this.fromAgent = fromAgent;
    this.toAgent = toAgent;
    this.reason = reason;
    this.briefing = briefing;
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
    const response = new AgentResponse(this.fromAgent, this.toAgent.name);
    response.setText(
      [this.reason, this.briefing]
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n\n')
    );
    return response.render(width);
  }
}
