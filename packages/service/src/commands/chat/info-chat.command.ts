import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class InfoChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'info';
  readonly usage = '/info <employee>';
  readonly description = 'Show team member info';
  readonly availableIn = { chat: true, tool: true };
  readonly group = 'chat';

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const query = args.trim();
    if (!query) {
      write(ctx, 'Usage: /info <name|role>');
      return;
    }
    const agents = await ctx.agentManager.resolveAgentAsync(query);
    if (agents.length === 0) {
      write(ctx, `No agent found matching: "${query}"`);
      return;
    }
    for (const a of agents) {
      write(ctx, `\n${a.name} (${a.role}) [${a.id}]`);
      if ((a as any).bio) write(ctx, (a as any).bio);
      if ((a as any).tools?.length) write(ctx, 'Tools: ' + (a as any).tools.join(', '));
    }
    write(ctx, '');
  }
}
