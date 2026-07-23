import type { Agent, ChatMessage, IEmitService } from '@ai-team/core';
import type { ChatThreadTranscriptEntry } from './chat-thread-transcript.js';

export interface IChatInfoService {
  showSessionIntro(args: {
    agent: Agent;
    developerName: string | undefined;
    workflowMode?: boolean;
    workflowExitWords?: string[];
  }): void;
  showLoadedInstructions(instructionCount: number): void;
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
    workflowMode?: boolean;
    workflowExitWords?: string[];
  }): void {
    const { agent, developerName, workflowMode, workflowExitWords } = args;

    this.emitService.log('info', `\nChat with ${agent.name} (${agent.role})`);
    this.emitService.emit({
      kind: 'agent_info',
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      developerName: developerName ?? undefined,
      llmModel: agent.resolvedLlm?.model,
      avatarColor: agent.avatar?.color,
    });

    this.emitService.log('info', 'Type "exit" to end the conversation');
    this.emitService.log('info', 'Type "/help" to see available in-chat commands');
    this.emitService.log('info', 'Ask to be forwarded or type "/chat <name>" to switch agents');

    if (workflowMode && (workflowExitWords?.length ?? 0) > 0) {
      const exitWords = workflowExitWords?.filter(Boolean).join(', ');
      if (exitWords) {
        this.emitService.log('info', `Type ${exitWords} to continue to the next workflow step`);
      }
    }
  }

  showLoadedInstructions(instructionCount: number): void {
    if (instructionCount > 0) {
      this.emitService.log('info', `Loaded ${instructionCount} instruction file(s)`);
    }
  }

  showSessionResume(
    history: ChatMessage[],
    agent: Agent,
    developerName: string | undefined
  ): void {
    const visible = history.filter((m) => !m.archived && !m.handoffType && m.importance !== 'low');
    if (visible.length === 0) return;

    for (const msg of visible) {
      this.emitService.emit({
        kind: 'history_message',
        content: msg.content,
        isHuman: msg.isHuman,
        developerName,
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
        llmModel: agent.resolvedLlm?.model,
        avatarColor: agent.avatar?.color,
      });
    }
  }

  showThreadResume(
    entries: ChatThreadTranscriptEntry[],
    developerName: string | undefined
  ): void {
    for (const entry of entries) {
      const message = entry.message;
      if (message.archived || message.importance === 'low') continue;

      if (entry.kind === 'handoff') {
        const fromAgent = entry.fromAgent;
        const toAgent = entry.toAgent;
        this.emitService.emit({
          kind: 'handoff',
          historical: true,
          fromAgentId: fromAgent?.id ?? message.from,
          fromAgentName: fromAgent?.name ?? message.from,
          fromAgentRole: fromAgent?.role,
          fromAvatarColor: fromAgent?.avatar?.color,
          fromLlmModel: fromAgent?.resolvedLlm?.model,
          fromSessionId: message.handoffFromSessionId,
          toAgentId: toAgent?.id ?? message.to ?? message.targetAgentId ?? 'unknown',
          toAgentName: toAgent?.name ?? message.to ?? message.targetAgentId ?? 'Agent',
          toAgentRole: toAgent?.role,
          toAvatarColor: toAgent?.avatar?.color,
          toLlmModel: toAgent?.resolvedLlm?.model,
          toSessionId: message.handoffToSessionId,
          briefingContent: message.content,
        });
        continue;
      }

      const agent = entry.agent;
      this.emitService.emit({
        kind: 'history_message',
        content: message.content,
        isHuman: message.isHuman === true,
        developerName,
        agentId: agent?.id,
        agentName: agent?.name,
        agentRole: agent?.role,
        llmModel: agent?.resolvedLlm?.model,
        avatarColor: agent?.avatar?.color,
      });
    }
  }
}
