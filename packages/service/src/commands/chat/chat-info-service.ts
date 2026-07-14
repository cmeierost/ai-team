import type { Agent, ChatMessage, IEmitService } from '@ai-team/core';

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
    agentName: string,
    developerName: string | undefined
  ): void {
    const visible = history.filter((m) => !m.archived && !m.handoffType && m.importance !== 'low');
    if (visible.length === 0) return;

    this.emitService.log('info', '\n─── Previous conversation ───────────────────────────────');
    for (const msg of visible) {
      const speaker = msg.isHuman ? (developerName ?? 'You') : agentName;
      const lines = msg.content
        .split('\n')
        .flatMap((line: string) =>
          line.length <= 100 ? [line] : (line.match(/.{1,100}(\s|$)/g) ?? [line])
        )
        .map((l: string, i: number) => (i === 0 ? l : `  ${l}`))
        .join('\n');
      this.emitService.log('info', `\n${speaker}: ${lines}`);
    }
    this.emitService.log('info', '\n─────────────────────────────────────────────────────────\n');
  }
}
