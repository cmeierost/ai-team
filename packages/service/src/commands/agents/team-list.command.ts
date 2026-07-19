import type {
  ICommand,
  IToolManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  ChatCommandEmitter,
} from '@ai-team/core';
export const TeamListChatCommandMetadata = {
  key: 'list',
  description: 'List all team members',
  availableIn: { chat: true, tool: true },
  group: 'chat',
} satisfies ICommandDescriptor;

export class TeamListChatCommand implements ICommand<string, void> {
  readonly metadata = TeamListChatCommandMetadata;

  constructor(
    private readonly toolManager: IToolManager,
    private readonly emitter: ChatCommandEmitter
  ) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const result = (await this.toolManager.execute(
      ctx.agent!,
      'team_list',
      {},
      {
        history: ctx.history,
        sessionId: ctx.sessionId,
        workflowId: ctx.workflowId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: ctx.stepId,
        workflowState: ctx.workflowState,
        currentFiles: ctx.currentFiles,
        signal: ctx.signal,
        invocationSurface: ctx.invocationSurface,
        callerType: ctx.callerType,
        calledByHuman: ctx.calledByHuman,
        agentId: ctx.agentId,
        instructions: ctx.instructions,
        navStack: ctx.navStack,
        workflowLastResult: ctx.workflowLastResult,
      }
    )) as {
      ok?: boolean;
      error?: string;
      result?: unknown;
    };

    if (!result.ok) {
      this.emitter.write(`Unable to list team members: ${result.error ?? 'unknown error'}`);
      return { status: 'ok' };
    }

    const payload = result.result as {
      members?: Array<{ agentId: string; agentName: string; agentRole: string }>;
    };
    const members = payload.members ?? [];
    if (members.length === 0) {
      this.emitter.write('No agents found.');
      return { status: 'ok' };
    }

    this.emitter.write('\nTeam members:');
    for (const member of members) {
      const marker = member.agentId === ctx.agent!?.id ? '  ← you are here' : '';
      this.emitter.write(
        `  ${member.agentName} (${member.agentRole}) [${member.agentId}]${marker}`
      );
    }
    this.emitter.write('');
    return { status: 'ok' };
  }
}
