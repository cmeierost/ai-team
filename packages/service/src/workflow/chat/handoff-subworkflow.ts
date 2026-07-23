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
import type { AgentRuntimeIdentityResolver } from '../../commands/chat/agent-runtime-identity.js';
import { LlmStreamDeltaExtractor, type LlmStreamChunk } from '../../llm/stream-events.js';

export interface HandoffSubWorkflowInput {
  ctx: ExecutionContext;
  targetAgentQuery: string;
  handoffNote?: string;
  navigationIntent?: 'handoff' | 'back';
}

export interface HandoffSubWorkflowResult {
  fromAgent: Agent;
  targetAgent: Agent;
  toSessionId: string;
  briefingContent: string;
  history: ChatMessage[];
  handoffId: string;
  fromSessionId: string;
  navigationStack: NonNullable<ExecutionContext['navStack']>;
}

export class HandoffSubWorkflow {
  private readonly streamDeltaExtractor = new LlmStreamDeltaExtractor();

  constructor(
    private readonly agentManager: IAgentManager,
    private readonly sessionManager: ISessionManager,
    private readonly threadManager: IThreadManager,
    private readonly llmService: ILlmService,
    private readonly emitService: IEmitService,
    private readonly identityResolver?: Pick<AgentRuntimeIdentityResolver, 'resolve'>
  ) {}

  async executeAsync(input: HandoffSubWorkflowInput): Promise<HandoffSubWorkflowResult> {
    const { ctx, targetAgentQuery, handoffNote, navigationIntent = 'handoff' } = input;

    if (!ctx.agent?.id || !ctx.sessionId) {
      throw new Error('Handoff requires an active agent and session context.');
    }

    const fromAgent = ctx.agent;
    const fromSessionId = ctx.sessionId;
    const loadedTarget = await this.resolveTargetAgentAsync(targetAgentQuery, fromAgent.id);

    if (!loadedTarget) {
      throw new Error(`No agent found matching: "${targetAgentQuery}"`);
    }
    const target = this.identityResolver?.resolve(loadedTarget) ?? loadedTarget;

    if (target.id === fromAgent.id) {
      throw new Error('Cannot hand off to yourself. Choose another agent.');
    }

    const currentSession = await this.sessionManager.getSession(fromSessionId);
    const developerId = currentSession?.developerId ?? 'unknown';
    const activeThread = await this.threadManager.resolveActiveSession(fromSessionId);
    const backFrame = activeThread.state.navigationStack.at(-1);
    if (navigationIntent === 'back' && !backFrame) {
      throw new Error('No previous agent to return to.');
    }
    const parentSession = currentSession?.previousSessionId
      ? await this.sessionManager.getSession(currentSession.previousSessionId)
      : null;
    const parentAgentIds = parentSession
      ? parentSession.agentIds?.length
        ? parentSession.agentIds
        : [parentSession.agentId]
      : [];
    const isReturnHandoff = navigationIntent === 'handoff' && parentAgentIds.includes(target.id);
    const toSessionId =
      navigationIntent === 'back'
        ? backFrame!.sessionId
        : isReturnHandoff
          ? currentSession!.previousSessionId!
          : (await this.threadManager.resolveHandoffSession(target.id, fromSessionId, developerId))
              .session.id;

    const handoffId = randomUUID();
    const handoffEventBase = {
      kind: 'handoff' as const,
      handoffId,
      fromAgentId: fromAgent.id,
      fromAgentName: fromAgent.name,
      fromAgentRole: fromAgent.role,
      fromAvatarColor: fromAgent.avatar?.color,
      fromLlmModel: fromAgent.resolvedLlm?.model,
      fromSessionId,
      toAgentId: target.id,
      toAgentName: target.name,
      toAgentRole: target.role,
      toAvatarColor: target.avatar?.color,
      toLlmModel: target.resolvedLlm?.model,
      toSessionId,
      handoffNote,
    };
    this.emitService.emit({
      ...handoffEventBase,
      handoffPhase: 'start',
    });

    let briefingContent = '';
    let history: ChatMessage[] = [];
    let briefingMsg: ChatMessage | undefined;
    let targetBriefingPersisted = false;
    let sourceBriefingPersisted = false;
    let threadState;
    try {
      briefingContent = await this.generateHandoffBriefingAsync(
        ctx,
        fromAgent,
        target,
        developerId,
        handoffNote ?? '',
        navigationIntent === 'back' || isReturnHandoff,
        (delta) => {
          this.emitService.emit({
            ...handoffEventBase,
            handoffPhase: 'delta',
            delta,
          });
        }
      );

      briefingMsg = {
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

      history = await this.sessionManager.getSessionMessages(toSessionId);
      history.push(briefingMsg);
      await this.sessionManager.appendMessage(toSessionId, briefingMsg);
      targetBriefingPersisted = true;
      await this.sessionManager.appendMessage(fromSessionId, briefingMsg);
      sourceBriefingPersisted = true;
      const sourceFrame = {
        agentId: fromAgent.id,
        agentName: fromAgent.name,
        sessionId: fromSessionId,
      };
      threadState =
        navigationIntent === 'back'
          ? await this.threadManager.recordBack(fromSessionId)
          : isReturnHandoff
            ? await this.threadManager.recordReturn(fromSessionId, toSessionId, sourceFrame)
            : await this.threadManager.recordHandoff(fromSessionId, toSessionId, {
                ...sourceFrame,
              });
    } catch (error) {
      const compensations: Promise<unknown>[] = [];
      if (sourceBriefingPersisted && briefingMsg) {
        compensations.push(
          this.sessionManager.deleteSessionMessage(fromSessionId, briefingMsg.timestamp)
        );
      }
      if (targetBriefingPersisted && briefingMsg) {
        compensations.push(
          this.sessionManager.deleteSessionMessage(toSessionId, briefingMsg.timestamp)
        );
      }
      await Promise.allSettled(compensations);
      this.emitService.emit({
        ...handoffEventBase,
        handoffPhase: 'cancelled',
      });
      throw error;
    }

    this.emitService.emit({
      ...handoffEventBase,
      handoffPhase: 'complete',
      briefingContent,
    });

    this.emitService.emit({
      kind: 'agent_info',
      agentId: target.id,
      agentName: target.name,
      agentRole: target.role,
      llmModel: target.resolvedLlm?.model,
      avatarColor: target.avatar?.color,
    });

    return {
      fromAgent,
      targetAgent: target,
      toSessionId,
      briefingContent,
      history,
      handoffId,
      fromSessionId,
      navigationStack: threadState.navigationStack,
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
    triggerMessage: string,
    isReturn: boolean,
    onDelta: (delta: string) => void
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
      const briefingInstructions = isReturn
        ? `Write 2-10 sentences in first person as ${fromAgent.name}. Summarise the work completed, ` +
          `important discoveries, decisions made, unresolved questions, and the recommended next action ` +
          `for ${toAgent.name}. Include only information needed to continue; do not copy the full private ` +
          `conversation. Do not add a subject line or greeting.`
        : `Write 2-10 sentences in first person as ${fromAgent.name}: summarise what you and ` +
          `${developerName} discussed, what ${developerName}'s goal is, and why you are ` +
          `forwarding them to ${toAgent.name}. ` +
          `Do not repeat the request word-for-word. Do not add a subject line or greeting.`;

      const stream = await this.llmService.streamChat(
        fromAgent,
        [
          {
            role: 'user',
            content:
              `You are ${agentTitle}. ` +
              `Write a handoff briefing for ${toAgent.name}.\n` +
              (triggerMessage ? `${developerName} said: "${triggerMessage}"\n\n` : '') +
              (historyText ? `Recent conversation:\n${historyText}\n\n` : '') +
              briefingInstructions,
          },
        ],
        { maxTokens: 250 }
      );

      let reply = '';
      for await (const chunk of stream) {
        const delta = this.streamDeltaExtractor.extractText(chunk as LlmStreamChunk);
        if (!delta) continue;
        reply += delta;
        onDelta(delta);
      }

      return reply.trim() || triggerMessage || `Handoff from ${fromAgent.name} to ${toAgent.name}.`;
    } catch {
      return triggerMessage || `Handoff from ${fromAgent.name} to ${toAgent.name}.`;
    }
  }
}
