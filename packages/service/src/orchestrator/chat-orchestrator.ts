/**
 * ChatOrchestrator — the stateful session controller.
 *
 * One instance per active session. Accepts a single user message, runs
 * through the pipeline, handles handoff / hire / slash commands, and
 * returns when the turn is complete.
 *
 * The orchestrator itself knows nothing about:
 *   - HTTP, WebSockets, CLI readline — those are in the adapter layer.
 *   - Specific tool implementations — those are in core / service tools.
 *   - Storage format — delegated to SessionManager + ChatRuntimeHooks.
 *
 * To extend: register pipeline plugins via OrchestratorPlugins before calling run().
 */

import { emitStatus, emitLog, emitEvent } from './stream-events.js';
import { detectForwardRequestWithFallback } from './forward-detection.js';
import { sendTurn } from './send-turn.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type { OrchestratorPlugins, ResolvedPlugins } from './pipeline.js';

/** Options for a single run() call. */
export interface RunOptions {
  /** Raw user message (may start with a slash command). */
  message: string;
  /** Files the user has open / selected in the IDE. */
  contextFiles?: string[];
  /**
   * Maximum number of automatic handoff hops allowed before the loop stops
   * and returns control to the caller. Prevents infinite handoff chains.
   * Default: 10.
   */
  maxHops?: number;
}

export class ChatOrchestrator {
  constructor(
    private ctx: OrchestratorContext,
    private plugins: ResolvedPlugins,
  ) {}

  /**
   * Execute one user turn. Returns the final response text.
   *
   * The loop continues across handoffs (agent switches) until:
   *   - The responding agent does NOT request a handoff, OR
   *   - The maximum hop count is reached.
   */
  async run(options: RunOptions): Promise<string> {
    const { message, contextFiles, maxHops = 10 } = options;

    // ── Slash command intercept ─────────────────────────────────────────────
    const slashResult = await this.trySlashCommand(message);
    if (slashResult !== null) return slashResult;

    // ── Natural-language forward detection ──────────────────────────────────
    const nlResult = await this.tryNlForward(message);
    if (nlResult !== null) return nlResult;

    // ── Turn loop (handles handoff chains) ──────────────────────────────────
    let currentMessage = message;
    let hops = 0;
    let lastText = '';

    while (hops < maxHops) {
      const result = await sendTurn(currentMessage, this.plugins, this.ctx);
      lastText = result.text;

      // ── Hire: reload agents, notify surface, continue ─────────────────────
      if (result.hired) {
        await this.ctx.agentManager.loadAllAgents();
        emitLog(
          this.ctx.hooks,
          'info',
          `${this.ctx.agent.name} hired ${result.hired.name} (${result.hired.role}).`,
        );
        // Hiring is a side-effect — the turn is still considered complete.
        break;
      }

      // ── Handoff: switch agent, loop ────────────────────────────────────────
      if (result.handedOff && result.handoffTargetId) {
        const switched = await this.switchAgent(
          result.handoffTargetId,
          result.handoffTargetSessionId,
          result.handoffNote,
        );

        if (!switched) {
          emitLog(
            this.ctx.hooks,
            'warn',
            `Handoff requested to unknown agent "${result.handoffTargetId}" — staying with ${this.ctx.agent.name}.`,
          );
          break;
        }

        emitStatus(
          this.ctx.hooks,
          'handoff',
          `${this.ctx.agent.name} taking over.`,
        );

        // The briefing note from the handing-off agent becomes the next message.
        currentMessage = result.handoffNote ?? `Continued from ${this.ctx.agent.id}.`;
        hops++;
        continue;
      }

      break;
    }

    if (hops >= maxHops) {
      emitLog(this.ctx.hooks, 'warn', `Maximum handoff chain length (${maxHops}) reached.`);
    }

    return lastText;
  }

  // ── Natural-language forward detection ──────────────────────────────────────

  /**
   * Detect if the message is a natural-language request to be forwarded to
   * another agent. Returns an empty string if a forward was handled (or a
   * near-miss warning was emitted), null if the message is not a forward.
   */
  private async tryNlForward(message: string): Promise<string | null> {
    const { resolved, looksLikeForward } = await detectForwardRequestWithFallback(
      message,
      this.ctx.agentManager,
      this.ctx.agent.id,
      this.ctx.llmService,
      this.ctx.agent,
      this.ctx.history,
    );

    if (resolved) {
      const fromAgent = this.ctx.agent;
      await this.switchAgent(resolved.id);
      emitLog(this.ctx.hooks, 'info', `\nSwitching to ${resolved.name} (${resolved.role})...\n`);
      emitEvent(this.ctx.hooks, {
        kind: 'handoff',
        fromAgentId: fromAgent.id,
        fromAgentName: fromAgent.name,
        toAgentId: resolved.id,
        toAgentName: resolved.name,
        toSessionId: this.ctx.sessionId,
        message: `Forwarded from ${fromAgent.name} to ${resolved.name}`,
      });
      return '';
    }

    if (looksLikeForward) {
      emitLog(
        this.ctx.hooks,
        'warn',
        `I couldn't find anyone on your team matching that request. Use /chat <name> to switch directly, or hire them first.`,
      );
      return '';
    }

    return null;
  }

  // ── Slash command handling ──────────────────────────────────────────────────

  /**
   * Returns the response string if a slash command was matched, null otherwise.
   */
  private async trySlashCommand(message: string): Promise<string | null> {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) return null;

    const [rawKey, ...rest] = trimmed.slice(1).split(/\s+/);
    const key = rawKey.toLowerCase();
    const rawArgs = rest.join(' ');

    const command = this.plugins.slashCommands.find(
      c => c.key === key || c.aliases?.includes(key),
    );

    if (!command) return null;

    await command.execute(rawArgs, this.ctx);
    return '';   // Slash commands handle their own output via hooks / stdout.
  }

  // ── Agent switching ─────────────────────────────────────────────────────────

  /**
   * Switch the current agent in `ctx`. Returns true if the target agent exists.
   * If `targetSessionId` is provided (pre-resolved by handoff_to_agent tool),
   * no extra session lookup is needed.
   */
  private async switchAgent(
    targetAgentId: string,
    targetSessionId?: string,
    handoffNote?: string,
  ): Promise<boolean> {
    const target = this.ctx.agentManager.getAgent(targetAgentId);
    if (!target) return false;

    // Derive the developer ID from the current session so we don't lose identity.
    const currentSession = await this.ctx.sessionManager.getSession(this.ctx.sessionId);
    const developerId = currentSession?.developerId ?? 'unknown';

    // Resolve (or create) the target session
    const targetSession = targetSessionId
      ? await this.ctx.sessionManager.getSession(targetSessionId)
      : await this.ctx.sessionManager.getOrCreateLatestSession(target.id, developerId);

    if (!targetSession) return false;
    const sessionId = targetSession.id;

    // Load history for the target's session
    const history = await this.ctx.sessionManager.getSessionMessages(sessionId);

    // Prepend briefing note as a synthetic human message so the target agent
    // sees context from the handing-off agent.
    if (handoffNote) {
      const briefing: import('@ai-team/core').ChatMessage = {
        from: this.ctx.agent.id,
        to: targetAgentId,
        content: `[Handoff briefing from ${this.ctx.agent.name}]: ${handoffNote}`,
        timestamp: new Date().toISOString(),
        isHuman: false,
      };
      history.push(briefing);
      await this.ctx.sessionManager.appendMessage(sessionId, briefing);
    }

    // Mutate context in place — all downstream pipeline stages see the new agent.
    (this.ctx as any).agent       = target;
    (this.ctx as any).sessionId   = sessionId;
    (this.ctx as any).history     = history;

    return true;
  }
}
