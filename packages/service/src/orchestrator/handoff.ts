/**
 * handoff.ts — full handoff sequence for ChatOrchestrator.
 *
 * Implements the six-step handoff protocol:
 *  1. Resolve the TO session (spine-aware — one session per agent per thread).
 *  2. Generate a fresh handoffId UUID.
 *  3. Write the parentNote to the FROM session with handoff columns stamped.
 *  4. Generate an LLM briefing in the FROM agent's voice, write to TO session.
 *  5. Emit the handoff runtime event with full fields.
 *  6. Mutate ctx so the next turn runs as the TO agent.
 *
 * Services are constructor-injected; ExecutionContext carries only
 * session-scoped state (no services).
 */

import { randomUUID } from 'node:crypto';
import type { Agent, ChatMessage, IAgentManager, ILlmService, ExecutionContext } from '@ai-team/core';
import type { SessionManager } from '../session-manager.js';
import { emitEvent, emitLog } from './stream-events.js';
import { detectForwardRequestWithFallbackAsync, extractForwardNote } from './forward-detection.js';

// ── HandoffOrchestrator ───────────────────────────────────────────────────────

export class HandoffOrchestrator {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly sessionManager: SessionManager,
    private readonly llmService: ILlmService
  ) {}

  /**
   * Detect if the message is a natural-language request to be forwarded to
   * another agent and, if so, execute the handoff.
   *
   * Returns 'forwarded' if a forward was handled (or a near-miss warning
   * was emitted), null if the message is not a forward request at all.
   */
  async tryNlForward(message: string, ctx: ExecutionContext): Promise<string | null> {
    const { resolved, looksLikeForward } = await detectForwardRequestWithFallbackAsync(
      message,
      this.agentManager,
      ctx.agent!.id,
      this.llmService,
      ctx.agent!,
      ctx.history
    );

    if (resolved) {
      // Persist the user's message before the handoff — sendTurn never runs
      // on this path, so this is the only place to record the human input.
      const userMsg: ChatMessage = {
        timestamp: new Date().toISOString(),
        from: 'human',
        to: ctx.agent!.id,
        isHuman: true,
        content: message,
      };
      await this.sessionManager.appendMessage(ctx.sessionId!, userMsg);
      ctx.history.push(userMsg);

      const note = extractForwardNote(message, resolved.name);
      await this.executeHandoff(ctx, resolved.id, undefined, note);
      emitLog('info', `\nSwitching to ${resolved.name} (${resolved.role})...\n`);
      return 'forwarded';
    }

    if (looksLikeForward) {
      emitLog(
        'warn',
        `I couldn't find anyone on your team matching that request. Try using their name directly.`
      );
      return null;
    }

    return null;
  }

  /**
   * Execute the full handoff sequence.
   *
   * Mutates `ctx` in place (agent, sessionId, history) so the next turn
   * runs as the target agent. Returns `true` if the handoff succeeded,
   * `false` if the target agent does not exist or the target session
   * could not be resolved.
   */
  async executeHandoff(
    ctx: ExecutionContext,
    targetAgentId: string,
    targetSessionId?: string,
    handoffNote?: string
  ): Promise<boolean> {
    const target =
      (await this.agentManager.getAgentAsync(targetAgentId)) ??
      (await this.agentManager.resolveAgentAsync(targetAgentId)).find((a) => a.id !== ctx.agent!.id);
    if (!target) return false;

    const currentSession = await this.sessionManager.getSession(ctx.sessionId!);
    const developerId = currentSession?.developerId ?? 'unknown';
    const fromSessionId = ctx.sessionId!;
    const fromAgent: Agent = ctx.agent!;

    // ── 1. Resolve the TO session (spine-aware) ─────────────────────────────
    let toSessionId: string;
    if (targetSessionId) {
      const pre = await this.sessionManager.getSession(targetSessionId);
      if (!pre) return false;
      toSessionId = pre.id;
    } else {
      const { session } = await this.sessionManager.resolveHandoffSession(
        target.id,
        fromSessionId,
        developerId
      );
      toSessionId = session.id;
    }

    // ── 2. Generate handoff ID ───────────────────────────────────────────────
    const handoffId = randomUUID();

    // ── 3. LLM briefing → BOTH sessions ─────────────────────────────────────
    const briefingContent = await this._generateHandoffBriefing(
      ctx,
      fromAgent,
      target,
      developerId,
      handoffNote ?? ''
    );
    const briefingMsg: ChatMessage = {
      from: fromAgent.id,
      to: target.id,
      content: briefingContent,
      timestamp: new Date().toISOString(),
      isHuman: false,
      handoffType: 'agent-briefing',
      handoffFromSessionId: fromSessionId,
      handoffToSessionId: toSessionId,
      handoffId,
    };
    // Write to TO session
    const history = await this.sessionManager.getSessionMessages(toSessionId);
    history.push(briefingMsg);
    await this.sessionManager.appendMessage(toSessionId, briefingMsg);

    // Write briefing to FROM session so the source thread also has it
    await this.sessionManager.appendMessage(fromSessionId, briefingMsg);

    // ── 5. Emit handoff event ────────────────────────────────────────────────
    emitEvent({
      kind: 'handoff',
      fromAgentId: fromAgent.id,
      fromAgentName: fromAgent.name,
      fromAgentRole: fromAgent.role,
      fromSessionId,
      toAgentId: target.id,
      toAgentName: target.name,
      toAgentRole: target.role,
      toSessionId,
      handoffNote,
      briefingContent,
    });

    // ── 6. Mutate context ────────────────────────────────────────────────────
    (ctx as any).agent = target;
    (ctx as any).sessionId = toSessionId;
    (ctx as any).history = history;

    return true;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _generateHandoffBriefing(
    ctx: ExecutionContext,
    fromAgent: Agent,
    toAgent: Agent,
    developerName: string,
    triggerMessage: string
  ): Promise<string> {
    try {
      const recentHistory = ctx.history.slice(-12);
      const historyText = recentHistory
        .map((m) => `${m.isHuman ? developerName : m.from}: ${m.content}`)
        .join('\n');

      const agentTitle = fromAgent.role ? `${fromAgent.name} (${fromAgent.role})` : fromAgent.name;

      const reply = await this.llmService.chat(
        fromAgent,
        [
          {
            role: 'user',
            content:
              `You are ${agentTitle}. ` +
              `Write a handoff briefing for ${toAgent.name}.\n` +
              (triggerMessage ? `${developerName} said: "${triggerMessage}"\n\n` : '') +
              (historyText ? `Recent conversation:\n${historyText}\n\n` : '') +
              `Write 2-10 sentences in first person as ${fromAgent.name}: summarise what you and ` +
              `${developerName} discussed, what ${developerName}'s goal is, and why you are ` +
              `forwarding them to ${toAgent.name}. ` +
              `Do not repeat the request word-for-word. Do not add a subject line or greeting.`,
          },
        ],
        { maxTokens: 250 }
      );
      return reply.trim();
    } catch {
      return triggerMessage || `Handoff from ${fromAgent.name} to ${toAgent.name}.`;
    }
  }
}
