import type {
  ExecutionContext,
  IAgentManager,
  IEmitService,
  ICommand,
  CommandResponse,
  ICommandDescriptor,
  ISessionManager,
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

  constructor(
    private readonly agentManager: Pick<IAgentManager, 'getAgentAsync'>,
    private readonly sessionManager: Pick<ISessionManager, 'getSessionMessages'>,
    private readonly emitService: IEmitService
  ) {}

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

    const fromAgent = ctx.agent;
    const fromSessionId = ctx.sessionId;

    const previousHistory = await this.sessionManager.getSessionMessages(prev.sessionId);

    ctx.agent = prevAgent;
    ctx.agentId = prev.agentId;
    ctx.sessionId = prev.sessionId;
    ctx.history = previousHistory;
    ctx.navStack = navStack;

    this.emitService.emit({
      kind: 'handoff',
      fromAgentId: fromAgent?.id,
      fromAgentName: fromAgent?.name,
      fromAgentRole: fromAgent?.role,
      fromSessionId,
      toAgentId: prevAgent.id,
      toAgentName: prevAgent.name,
      toAgentRole: prevAgent.role,
      toSessionId: prev.sessionId,
      handoffNote: 'Returning to parent session via /back',
      briefingContent: 'Return handoff to parent session.',
    });

    this.emitService.emit({
      kind: 'agent_info',
      agentId: prevAgent.id,
      agentName: prevAgent.name,
      agentRole: prevAgent.role,
      llmModel: prevAgent.resolvedLlm?.model,
    });

    this.emitService.emit({
      kind: 'session_switched',
      agentId: prevAgent.id,
      sessionId: prev.sessionId,
      source: 'back',
    });

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
