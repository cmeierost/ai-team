import type { Agent, ChatMessage } from '@ai-team/core';
import type { EmitSink } from './chat-emitter.js';
import { emitRuntimeEvent, printSessionResume, writeInfo } from './chat-emitter.js';

export interface IChatInfoService {
  showSessionIntro(args: {
    sink: EmitSink;
    agent: Agent;
    developerName: string | undefined;
    workflowMode?: boolean;
    workflowExitWords?: string[];
  }): void;
  showLoadedInstructions(sink: EmitSink, instructionCount: number): void;
  showSessionResume(
    history: ChatMessage[],
    agentName: string,
    developerName: string | undefined,
    sink: EmitSink
  ): void;
}

export class ChatInfoService implements IChatInfoService {
  showSessionIntro(args: {
    sink: EmitSink;
    agent: Agent;
    developerName: string | undefined;
    workflowMode?: boolean;
    workflowExitWords?: string[];
  }): void {
    const { sink, agent, developerName, workflowMode, workflowExitWords } = args;

    writeInfo(sink, `\nChat with ${agent.name} (${agent.role})`);
    emitRuntimeEvent(sink, {
      kind: 'agent_info',
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      developerName: developerName ?? undefined,
    });

    writeInfo(sink, 'Type "exit" to end the conversation');
    writeInfo(sink, 'Type "/help" to see available in-chat commands');
    writeInfo(sink, 'Ask to be forwarded or type "/chat <name>" to switch agents');
    writeInfo(sink, 'Use "#tool_name {json}" or "/tool tool_name {json}" for direct tool calls');

    if (workflowMode && (workflowExitWords?.length ?? 0) > 0) {
      const exitWords = workflowExitWords?.filter(Boolean).join(', ');
      if (exitWords) {
        writeInfo(sink, `Type ${exitWords} to continue to the next workflow step`);
      }
    }
  }

  showLoadedInstructions(sink: EmitSink, instructionCount: number): void {
    if (instructionCount > 0) {
      writeInfo(sink, `Loaded ${instructionCount} instruction file(s)`);
    }
  }

  showSessionResume(
    history: ChatMessage[],
    agentName: string,
    developerName: string | undefined,
    sink: EmitSink
  ): void {
    if (history.length > 0) {
      printSessionResume(history, agentName, developerName, sink);
    }
  }
}
