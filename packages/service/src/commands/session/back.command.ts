import type {
  ExecutionContext,
  IAgentManager,
  ICommand,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';

export interface BackResult {
  agentId: string;
  agentName: string;
  agentRole: string;
  sessionId?: string;
}
export const BackChatCommandMetadata = {
  key: 'back',
  description: 'Return to previous agent in handoff chain',
  availableIn: { chat: true, tool: false },
  group: 'session',
} satisfies ICommandDescriptor;

export class BackChatCommand implements ICommand<string, BackResult> {
  readonly metadata = BackChatCommandMetadata;

  constructor(private readonly agentManager: Pick<IAgentManager, 'getAgentAsync'>) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<BackResult>> {
    const navStack = ctx.navStack ?? [];
    if (navStack.length === 0) {
      return { status: 'error', message: 'No previous agent to return to.' };
    }
    const prev = navStack.pop()!;
    const prevAgent = await this.agentManager.getAgentAsync(prev.agentId);
    if (!prevAgent) {
      return { status: 'error', message: `Previous agent ${prev.agentId} no longer found.` };
    }
    ctx.agentId = prev.agentId;
    ctx.sessionId = prev.sessionId;
    return {
      status: 'ok',
      message: `← Returned to ${prevAgent.name} (${prevAgent.role})`,
      data: {
        agentId: prevAgent.id,
        agentName: prevAgent.name,
        agentRole: prevAgent.role,
        sessionId: prev.sessionId,
      },
    };
  }
}
