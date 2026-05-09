import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class FireChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'fire';
  readonly usage = '/fire <employee>';
  readonly description = 'Interactive: remove a team member';
  readonly availableIn = { chat: true, tool: true };
  readonly group = 'chat';

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    if (!args.trim()) {
      write(ctx, 'Usage: /fire <name|id>');
      return;
    }
    const mod = (await import('../hr/fire.js')) as any;
    if (typeof mod.fireCommand === 'function') {
      await mod.fireCommand(ctx.workspaceRoot, args.trim(), {});
    }
    await ctx.agentManager.refreshAsync();
  }
}
