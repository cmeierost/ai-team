import type { Agent, ChatMessage, IEmitService, RuntimeStreamEvent } from '@ai-team/core';
import type { ChatThreadTranscriptEntry } from './chat-thread-transcript.js';
import { isHandoffAutoReactMessage } from '../../workflow/chat/handoff-auto-react.js';

export interface IChatInfoService {
  showSessionIntro(args: {
    agent: Agent;
    developerName: string | undefined;
  }): void;
  showLoadedInstructions(instructionCount: number): void;
  showWorkspaceInfo(args: { workspace: string; gitBranch?: string | null }): void;
  showActiveSession(args: { sessionId: string; agentId: string }): void;
  showSessionResume(
    history: ChatMessage[],
    agent: Agent,
    developerName: string | undefined
  ): void;
  showThreadResume(
    entries: ChatThreadTranscriptEntry[],
    developerName: string | undefined
  ): void;
}

export class ChatInfoService implements IChatInfoService {
  constructor(private readonly emitService: IEmitService) {}
  showSessionIntro(args: {
    agent: Agent;
    developerName: string | undefined;
  }): void {
    const { agent, developerName } = args;

    this.emitService.emit({
      kind: 'agent_info',
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      developerName: developerName ?? undefined,
      llmModel: agent.resolvedLlm?.model,
      avatarColor: agent.avatar?.color,
      message: 'exit · /help · /handoff <name>',
    });

  }

  showLoadedInstructions(instructionCount: number): void {
    if (instructionCount > 0) {
      this.emitService.log('info', `Loaded ${instructionCount} instruction file(s)`);
    }
  }

  showWorkspaceInfo(args: { workspace: string; gitBranch?: string | null }): void {
    this.emitService.emit({
      kind: 'workspace_info',
      workspace: args.workspace,
      gitBranch: args.gitBranch ?? undefined,
    });
  }

  showActiveSession(args: { sessionId: string; agentId: string }): void {
    this.emitService.emit({
      kind: 'session_switched',
      sessionId: args.sessionId,
      agentId: args.agentId,
      source: 'startup',
    });
  }

  showSessionResume(
    history: ChatMessage[],
    agent: Agent,
    developerName: string | undefined
  ): void {
    const visible = history.filter(
      (m) =>
        !m.archived &&
        !m.handoffType &&
        m.importance !== 'low' &&
        !(m.isHuman && isHandoffAutoReactMessage(m.content))
    );
    if (visible.length === 0) return;

    const timeline: HistoricalTimelineEntry[] = [];
    let order = 0;
    for (const msg of visible) {
      if (msg.kind === 'error') {
        timeline.push({
          at: msg.timestamp ?? '',
          order: order++,
          event: {
            kind: 'error',
            historical: true,
            message: msg.content,
            failureId: msg.failureId,
            errorCode: msg.errorCode,
            errorDetails: msg.errorDetails,
          },
        });
        continue;
      }
      if (msg.content.trim().length > 0 || !msg.tool_calls?.length) {
        timeline.push({
          at: msg.timestamp ?? '',
          order: order++,
          event: {
          kind: 'history_message',
          historical: true,
          content: msg.content,
          isHuman: msg.isHuman,
          developerName,
          agentId: agent.id,
          agentName: agent.name,
          agentRole: agent.role,
          llmModel: agent.resolvedLlm?.model,
          avatarColor: agent.avatar?.color,
          },
        });
      }
      for (const event of this.buildHistoricalToolEvents(msg)) {
        timeline.push({
          at: String(event.timestamp ?? msg.timestamp ?? ''),
          order: order++,
          event,
        });
      }
    }
    this.emitTimeline(timeline);
  }

  showThreadResume(
    entries: ChatThreadTranscriptEntry[],
    developerName: string | undefined
  ): void {
    const timeline: HistoricalTimelineEntry[] = [];
    let order = 0;
    for (const entry of entries) {
      const message = entry.message;
      if (
        message.archived ||
        message.importance === 'low' ||
        (message.isHuman && isHandoffAutoReactMessage(message.content))
      ) {
        continue;
      }

      if (message.kind === 'error') {
        timeline.push({
          at: message.timestamp ?? '',
          order: order++,
          event: {
            kind: 'error',
            historical: true,
            message: message.content,
            failureId: message.failureId,
            errorCode: message.errorCode,
            errorDetails: message.errorDetails,
          },
        });
        continue;
      }

      if (entry.kind === 'handoff') {
        const fromAgent = entry.fromAgent;
        const toAgent = entry.toAgent;
        timeline.push({
          at: message.timestamp ?? '',
          order: order++,
          event: {
            kind: 'handoff',
            historical: true,
            fromAgentId: fromAgent?.id ?? message.from,
            fromAgentName: fromAgent?.name ?? message.from,
            fromAgentRole: fromAgent?.role,
            fromAvatarColor: fromAgent?.avatar?.color,
            fromLlmModel: fromAgent?.resolvedLlm?.model,
            fromSessionId: message.handoffFromSessionId,
            handoffId: message.handoffId,
            toAgentId: toAgent?.id ?? message.to ?? message.targetAgentId ?? 'unknown',
            toAgentName: toAgent?.name ?? message.to ?? message.targetAgentId ?? 'Agent',
            toAgentRole: toAgent?.role,
            toAvatarColor: toAgent?.avatar?.color,
            toLlmModel: toAgent?.resolvedLlm?.model,
            toSessionId: message.handoffToSessionId,
            briefingContent: message.content,
          },
        });
        continue;
      }

      const agent = entry.agent;
      if (message.content.trim().length > 0 || !message.tool_calls?.length) {
        timeline.push({
          at: message.timestamp ?? '',
          order: order++,
          event: {
            kind: 'history_message',
            historical: true,
            content: message.content,
            isHuman: message.isHuman === true,
            developerName,
            agentId: agent?.id,
            agentName: agent?.name,
            agentRole: agent?.role,
            llmModel: agent?.resolvedLlm?.model,
            avatarColor: agent?.avatar?.color,
          },
        });
      }
      for (const event of this.buildHistoricalToolEvents(message)) {
        timeline.push({
          at: String(event.timestamp ?? message.timestamp ?? ''),
          order: order++,
          event,
        });
      }
    }
    this.emitTimeline(timeline);
  }

  private buildHistoricalToolEvents(message: ChatMessage): RuntimeStreamEvent[] {
    const events: RuntimeStreamEvent[] = [];
    for (const call of message.tool_calls ?? []) {
      const toolCallId = call.callId ?? (call.id === undefined ? undefined : String(call.id));
      events.push({
        kind: 'tool',
        historical: true,
        toolName: call.tool,
        toolCallId,
        toolPhase: 'request',
        input: call.params,
        timestamp: call.requestedAt ?? message.timestamp,
      });

      if (call.result === undefined && call.resultLlm === undefined) {
        continue;
      }

      const resultStatus =
        call.result
        && typeof call.result === 'object'
        && 'status' in call.result
          ? (call.result as { status?: unknown }).status
          : undefined;
      const toolPhase = resultStatus === 'error' ? 'error' : 'result';
      const output = call.tool.startsWith('slash:')
        ? (call.resultLlm ?? call.result)
        : (call.result ?? call.resultLlm);

      events.push({
        kind: 'tool',
        historical: true,
        toolName: call.tool,
        toolCallId,
        toolPhase: call.resultPhase ?? toolPhase,
        output,
        timestamp: call.completedAt ?? message.timestamp,
      });
    }
    return events;
  }

  private emitTimeline(timeline: HistoricalTimelineEntry[]): void {
    timeline
      .sort((left, right) => left.at.localeCompare(right.at) || left.order - right.order)
      .forEach(({ event }) => this.emitService.emit(event));
  }
}

interface HistoricalTimelineEntry {
  at: string;
  order: number;
  event: RuntimeStreamEvent;
}
