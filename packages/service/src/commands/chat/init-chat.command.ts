import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';

export class InitChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'init';
  readonly description = 'Interactive: (re-)initialize workspace';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(_args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const mod = (await import('../init/init.js')) as any;
    if (typeof mod.initCommand === 'function') {
      await mod.initCommand(ctx.workspaceRoot, {});
    }
    await ctx.agentManager.refreshAsync();
  }
}
