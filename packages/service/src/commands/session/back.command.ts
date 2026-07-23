import type {
  ExecutionContext,
  IEmitService,
  ICommand,
  CommandResponse,
  ICommandDescriptor,
  IThreadManager,
} from '@ai-team/core';
import { HandoffSubWorkflow } from '../../workflow/chat/handoff-subworkflow.js';

export interface BackResult {
  agentId: string;
  agentName: string;
  agentRole: string;
  sessionId?: string;
}
export const BackChatCommandMetadata = {
  key: 'back',
  aliases: ['back'],
  description: 'Return to previous agent in handoff chain',
  availableIn: { chat: true, tool: false },
  group: 'session',
} satisfies ICommandDescriptor;

export class BackChatCommand implements ICommand<string, BackResult> {
  readonly metadata = BackChatCommandMetadata;

  constructor(
    private readonly handoffSubWorkflow: HandoffSubWorkflow,
    private readonly threadManager: IThreadManager,
    private readonly emitService: IEmitService
  ) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<BackResult>> {
    if (!ctx.sessionId) {
      return { status: 'error', message: 'No previous agent to return to.' };
    }
    const active = await this.threadManager.resolveActiveSession(ctx.sessionId);
    const previous = active.state.navigationStack.at(-1);
    if (!previous) {
      return { status: 'error', message: 'No previous agent to return to.' };
    }
    const transition = await this.handoffSubWorkflow.executeAsync({
      ctx,
      targetAgentQuery: previous.agentId,
      handoffNote: 'Returning to the delegating agent via /back.',
      navigationIntent: 'back',
    });

    ctx.agent = transition.targetAgent;
    ctx.agentId = transition.targetAgent.id;
    ctx.sessionId = transition.toSessionId;
    ctx.history = transition.history;
    ctx.navStack = [...transition.navigationStack];

    this.emitService.emit({
      kind: 'session_switched',
      agentId: transition.targetAgent.id,
      sessionId: transition.toSessionId,
      source: 'back',
    });

    return {
      status: 'ok',
      message: `← Returned to ${transition.targetAgent.name} (${transition.targetAgent.role})`,
      data: {
        agentId: transition.targetAgent.id,
        agentName: transition.targetAgent.name,
        agentRole: transition.targetAgent.role,
        sessionId: transition.toSessionId,
      },
    };
  }
}
