import type { Agent, ChatMessage } from '@ai-team/core';
import { printSessionResume } from './chat-emitter.js';
import { emitLog, emitEvent } from './stream-events.js';

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
    agentName: string,
    developerName: string | undefined
  ): void;
}

export class ChatInfoService implements IChatInfoService {
  showSessionIntro(args: {
    agent: Agent;
    developerName: string | undefined;
    workflowMode?: boolean;
    workflowExitWords?: string[];
  }): void {
    const { agent, developerName, workflowMode, workflowExitWords } = args;

    emitLog('info', `\nChat with ${agent.name} (${agent.role})`);
    emitEvent({
      kind: 'agent_info',
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      developerName: developerName ?? undefined,
    });

    emitLog('info', 'Type "exit" to end the conversation');
    emitLog('info', 'Type "/help" to see available in-chat commands');
    emitLog('info', 'Ask to be forwarded or type "/chat <name>" to switch agents');
    emitLog('info', 'Use "#tool_name {json}" or "/tool tool_name {json}" for direct tool calls');

    if (workflowMode && (workflowExitWords?.length ?? 0) > 0) {
      const exitWords = workflowExitWords?.filter(Boolean).join(', ');
      if (exitWords) {
        emitLog('info', `Type ${exitWords} to continue to the next workflow step`);
      }
    }
  }

  showLoadedInstructions(instructionCount: number): void {
    if (instructionCount > 0) {
      emitLog('info', `Loaded ${instructionCount} instruction file(s)`);
    }
  }

  showSessionResume(
    history: ChatMessage[],
    agentName: string,
    developerName: string | undefined
  ): void {
    if (history.length > 0) {
      printSessionResume(history, agentName, developerName);
    }
  }
}
