import type { ICommand, IToolManager, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { ChatCommandEmitter } from '../../orchestrator/chat-emitter.js';

export class TeamListChatCommand implements ICommand<string, void> {
  readonly key = 'list';
  readonly description = 'List all team members';
  readonly availableIn = { chat: true, tool: true };
  readonly group = 'chat';

  constructor(
    private readonly toolManager: IToolManager,
    private readonly emitter: ChatCommandEmitter
  ) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const result = (await this.toolManager.execute(ctx.agent!, 'team_list', {})) as {
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
