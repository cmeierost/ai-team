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

const HANDOFF_BRIEFING_MAX_TOKENS = 1600;
const FALLBACK_STREAM_CHUNK_CHARACTERS = 64;

export interface HandoffSubWorkflowInput {
  ctx: ExecutionContext;
  targetAgentQuery: string;
  handoffNote?: string;
  navigationIntent?: 'handoff' | 'back';
  sourceToolCallId?: string;
  sourceSessionId?: string;
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
    const { ctx, targetAgentQuery, handoffNote, navigationIntent = 'handoff', sourceToolCallId, sourceSessionId } = input;

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
        ...(sourceToolCallId ? { handoffToolCallId: sourceToolCallId } : {}),
        ...(sourceSessionId ? { handoffSourceSessionId: sourceSessionId } : {}),
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
    let fromSessionHistory = ctx.history;
    try {
      fromSessionHistory =
        ctx.history.length > 0
          ? ctx.history
          : await this.sessionManager.getSessionMessages(ctx.sessionId ?? '');

      // A long delegated conversation can push the incoming briefing out of the
      // recent window. Keep it so a return summary still answers the original
      // handoff rather than only recapping its final few messages.
      const recentHistory = this.selectBriefingHistory(fromSessionHistory);
      const historyText = recentHistory
        .map((m) => `${m.isHuman ? developerName : m.from}: ${m.content}`)
        .join('\n');

      const agentTitle = fromAgent.role ? `${fromAgent.name} (${fromAgent.role})` : fromAgent.name;
      const briefingInstructions = isReturn
        ? `Write 2-10 sentences in first person as ${fromAgent.name}. This is a return briefing for ` +
          `${toAgent.name}${toAgent.role ? ` (${toAgent.role})` : ''}; it must stand alone as the ` +
          `useful response to the handoff they originally made. Answer the original incoming handoff ` +
          `and every question or request that led to it using the conclusions in the later conversation. ` +
          `Do not mention /return, navigation, returning, or ask the recipient what was discovered. ` +
          `Lead with the outcome, then cover the ` +
          `decisions made, important discoveries, unresolved questions or risks, ownership, and the recommended ` +
          `next action for ${toAgent.name}. Tailor the detail to ${toAgent.name}'s responsibilities: ` +
          `${this.buildRecipientFocus(toAgent)} Include only information needed to continue; do not copy ` +
          `the full private conversation. Do not add a subject line or greeting.`
        : `Write 2-10 sentences in first person as ${fromAgent.name}: summarise what you and ` +
          `${developerName} discussed and why you are forwarding them to ${toAgent.name}. Make ` +
          `the developer's objective, the receiving agent's responsibility, what the receiving ` +
          `agent should do first, relevant decisions or constraints, and any requested return or ` +
          `follow-up path explicit. Tell ${toAgent.name} that they must continue the conversation ` +
          `with the developer, not reply to you. Address ${toAgent.name} as "you" when assigning ` +
          `the next step. Do not invent missing decisions or a return path, repeat the request ` +
          `word-for-word, or add a subject line or greeting.`;

      const stream = await this.llmService.streamChat(
        fromAgent,
        [
          {
            role: 'user',
            content:
              `You are ${agentTitle}. ` +
              `Write a handoff briefing for ${toAgent.name}.\n` +
              (!isReturn && triggerMessage
                ? `${developerName} said: "${triggerMessage}"\n\n`
                : '') +
              (historyText ? `Recent conversation:\n${historyText}\n\n` : '') +
              briefingInstructions,
          },
        ],
        { maxTokens: HANDOFF_BRIEFING_MAX_TOKENS }
      );

      let reply = '';
      for await (const chunk of stream) {
        const delta = this.streamDeltaExtractor.extractText(chunk as LlmStreamChunk);
        if (!delta) continue;
        reply += delta;
        onDelta(delta);
      }

      if (reply.trim()) {
        return reply;
      }
      return await this.streamFallbackBriefing(
        fromSessionHistory,
        fromAgent,
        triggerMessage,
        isReturn,
        onDelta
      );
    } catch {
      return await this.streamFallbackBriefing(
        fromSessionHistory,
        fromAgent,
        triggerMessage,
        isReturn,
        onDelta
      );
    }
  }

  private async streamFallbackBriefing(
    history: ChatMessage[],
    fromAgent: Agent,
    triggerMessage: string,
    isReturn: boolean,
    onDelta: (delta: string) => void
  ): Promise<string> {
    const fallback = this.buildFallbackBriefing(history, fromAgent, triggerMessage, isReturn);
    const characters = Array.from(fallback);

    for (let offset = 0; offset < characters.length; offset += FALLBACK_STREAM_CHUNK_CHARACTERS) {
      onDelta(characters.slice(offset, offset + FALLBACK_STREAM_CHUNK_CHARACTERS).join(''));
      // Let InteractionStream dequeue and transport each fallback chunk before
      // the handoff completes. Without this yield, the TUI sees only the final
      // briefing event when a provider emits reasoning but no visible content.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return fallback;
  }

  private buildFallbackBriefing(
    history: ChatMessage[],
    fromAgent: Agent,
    triggerMessage: string,
    isReturn: boolean
  ): string {
    if (isReturn) {
      const latestSubstantiveAnswer = [...history]
        .reverse()
        .find(
          (message) =>
            !message.isHuman &&
            message.from === fromAgent.id &&
            !message.handoffType &&
            !message.archived &&
            !message.hiddenFromLlm &&
            message.content.trim().length > 0
        );
      if (latestSubstantiveAnswer) {
        return latestSubstantiveAnswer.content.trim();
      }

      const originalBriefing = history.find(
        (message) =>
          message.handoffType === 'agent-briefing' && message.content.trim().length > 0
      );
      if (originalBriefing) {
        return (
          `I do not have a substantive result to return yet. ` +
          `The original request was: ${originalBriefing.content.trim()}`
        );
      }
    }

    return triggerMessage || `Handoff from ${fromAgent.name} to the receiving agent.`;
  }

  private selectBriefingHistory(history: ChatMessage[]): ChatMessage[] {
    const recent = history.slice(-12);
    const incomingBriefing = [...history]
      .reverse()
      .find((message) => message.handoffType === 'agent-briefing');

    return incomingBriefing && !recent.includes(incomingBriefing)
      ? [incomingBriefing, ...recent]
      : recent;
  }

  private buildRecipientFocus(agent: Agent): string {
    const role = agent.role.toLowerCase();
    const isExecutive =
      agent.type === 'executive' ||
      ['ceo', 'cto', 'vp', 'director', 'executive'].some((term) => role.includes(term));

    if (isExecutive) {
      return 'For this executive recipient, focus on the goal, outcome, decisions, business impact, risks, ownership, and any decision or support needed. Omit implementation mechanics, code details, and routine troubleshooting unless they materially affect one of those points.';
    }

    return 'Include the decisions, constraints, ownership, and technical or domain detail needed for this recipient to continue their own work; omit details outside their responsibility.';
  }
}
