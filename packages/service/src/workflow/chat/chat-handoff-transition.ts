import { randomUUID } from 'node:crypto';
import type {
  Agent,
  ChatMessage,
  IAgentManager,
  ILlmService,
  IEmitService,
  ExecutionContext,
} from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';

/**
 * Runtime service for chat handoff transitions.
 *
 * IMPORTANT: this is not the `/handoff` command implementation.
 * The command parses user intent/args; this service performs the transition side effects:
 * - resolve target agent
 * - resolve/create target session branch
 * - generate and persist handoff briefing
 * - switch runtime execution context to the target agent/session
 */
export class ChatHandoffTransitionService {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly sessionManager: SessionManager,
    private readonly llmService: ILlmService,
    private readonly emitService: IEmitService
  ) {}

  async executeHandoff(
    ctx: ExecutionContext,
    targetAgentId: string,
    targetSessionId?: string,
    handoffNote?: string
  ): Promise<boolean> {
    const target =
      (await this.agentManager.getAgentAsync(targetAgentId)) ??
      (await this.agentManager.resolveAgentAsync(targetAgentId)).find(
        (a) => a.id !== ctx.agent!.id
      );
    if (!target) return false;

    const currentSession = await this.sessionManager.getSession(ctx.sessionId!);
    const developerId = currentSession?.developerId ?? 'unknown';
    const fromSessionId = ctx.sessionId!;
    const fromAgent: Agent = ctx.agent!;

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

    const handoffId = randomUUID();

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

    const history = await this.sessionManager.getSessionMessages(toSessionId);
    history.push(briefingMsg);
    await this.sessionManager.appendMessage(toSessionId, briefingMsg);
    await this.sessionManager.appendMessage(fromSessionId, briefingMsg);

    this.emitService.emit({
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

    ctx.agent = target;
    ctx.sessionId = toSessionId;
    ctx.history = history;

    return true;
  }

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

// Temporary compatibility alias while callsites migrate naming.
