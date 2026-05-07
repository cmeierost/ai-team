import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class TeamListChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'list';
  readonly description = 'List all team members';
  readonly availableIn = { chat: true, tool: true };

  async execute(_args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const result = await ctx.toolManager.execute(ctx.agent, 'team_list', {}, {
      agentId: ctx.agent.id,
      workspaceRoot: ctx.workspaceRoot,
    });

    if (!result.ok) {
      write(ctx, `Unable to list team members: ${result.error ?? 'unknown error'}`);
      return;
    }

    const payload = result.result as {
      members?: Array<{ agentId: string; agentName: string; agentRole: string }>;
    };
    const members = payload.members ?? [];
    if (members.length === 0) {
      write(ctx, 'No agents found.');
      return;
    }

    write(ctx, '\nTeam members:');
    for (const member of members) {
      const marker = member.agentId === ctx.agent.id ? '  ← you are here' : '';
      write(ctx, `  ${member.agentName} (${member.agentRole}) [${member.agentId}]${marker}`);
    }
    write(ctx, '');
  }
}
