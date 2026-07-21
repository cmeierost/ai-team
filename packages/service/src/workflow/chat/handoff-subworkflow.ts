import { randomUUID } from 'node:crypto';
import type {
  Agent,
  ChatMessage,
  ExecutionContext,
  IAgentManager,
  IEmitService,
  ILlmService,
  ISessionManager,
  IThreadManager,
} from '@ai-team/core';

export interface HandoffSubWorkflowInput {
  ctx: ExecutionContext;
  targetAgentQuery: string;
  handoffNote?: string;
}

export interface HandoffSubWorkflowResult {
  fromAgent: Agent;
  targetAgent: Agent;
  toSessionId: string;
  briefingContent: string;
  history: ChatMessage[];
  handoffId: string;
  fromSessionId: string;
}

export class HandoffSubWorkflow {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly sessionManager: ISessionManager,
    private readonly threadManager: IThreadManager,
    private readonly llmService: ILlmService,
    private readonly emitService: IEmitService
  ) {}

  async executeAsync(input: HandoffSubWorkflowInput): Promise<HandoffSubWorkflowResult> {
    const { ctx, targetAgentQuery, handoffNote } = input;

    if (!ctx.agent?.id || !ctx.sessionId) {
      throw new Error('Handoff requires an active agent and session context.');
    }

    const fromAgent = ctx.agent;
    const fromSessionId = ctx.sessionId;
    const target = await this.resolveTargetAgentAsync(targetAgentQuery, fromAgent.id);

    if (!target) {
      throw new Error(`No agent found matching: "${targetAgentQuery}"`);
    }

    if (target.id === fromAgent.id) {
      throw new Error('Cannot hand off to yourself. Choose another agent.');
    }

    const currentSession = await this.sessionManager.getSession(fromSessionId);
    const developerId = currentSession?.developerId ?? 'unknown';

    const { session } = await this.threadManager.resolveHandoffSession(
      target.id,
      fromSessionId,
      developerId
    );
    const toSessionId = session.id;

    const briefingContent = await this.generateHandoffBriefingAsync(
      ctx,
      fromAgent,
      target,
      developerId,
      handoffNote ?? ''
    );

    const handoffId = randomUUID();
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

    this.emitService.emit({
      kind: 'agent_info',
      agentId: target.id,
      agentName: target.name,
      agentRole: target.role,
      llmModel: target.resolvedLlm?.model,
    });

    return {
      fromAgent,
      targetAgent: target,
      toSessionId,
      briefingContent,
      history,
      handoffId,
      fromSessionId,
    };
  }

  private async resolveTargetAgentAsync(
    query: string,
    sourceAgentId: string
  ): Promise<Agent | null> {
    const trimmed = query.trim();
    if (!trimmed) {
      return null;
    }

    const resolvedForOperation = await this.agentManager.resolveAgentForOperationAsync(
      trimmed,
      'chat handoff'
    );
    const resolvedAgent = await this.agentManager.getAgentAsync(resolvedForOperation.id);
    if (resolvedAgent) {
      return resolvedAgent;
    }

    const resolved = await this.agentManager.resolveAgentAsync(trimmed);
    if (resolved.length > 0) {
      return resolved.find((candidate) => candidate.id !== sourceAgentId) ?? resolved[0];
    }

    const lowered = trimmed.toLowerCase();
    const allAgents = await this.agentManager.getAllAgentsAsync();
    const fallback = allAgents.filter((candidate) => {
      return (
        candidate.id.toLowerCase() === lowered ||
        candidate.name.toLowerCase() === lowered ||
        candidate.role.toLowerCase() === lowered
      );
    });

    return fallback.find((candidate) => candidate.id !== sourceAgentId) ?? fallback[0] ?? null;
  }

  private async generateHandoffBriefingAsync(
    ctx: ExecutionContext,
    fromAgent: Agent,
    toAgent: Agent,
    developerName: string,
    triggerMessage: string
  ): Promise<string> {
    try {
      const fromSessionHistory =
        ctx.history.length > 0
          ? ctx.history
          : await this.sessionManager.getSessionMessages(ctx.sessionId ?? '');

      const recentHistory = fromSessionHistory.slice(-12);
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
