import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';

export class CreateChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'create';
  readonly usage = '/create [employee|skill]';
  readonly description = 'Interactive: create an agent or skill';
  readonly availableIn = { chat: true, tool: true };
  readonly group = 'chat';

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const type = (args.trim() || 'agent').split(/\s+/)[0];
    const mod = (await import('../hr/create.js')) as any;
    if (typeof mod.createCommand === 'function') {
      await mod.createCommand(ctx.workspaceRoot, type, { interactive: true });
    }
    await ctx.agentManager.refreshAsync();
  }
}
