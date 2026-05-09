import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';

export class HireChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'hire';
  readonly description = 'Interactive: hire a new team member';
  readonly availableIn = { chat: true, tool: true };
  readonly group = 'chat';

  async execute(_args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const mod = (await import('../hr/hire.js')) as any;
    if (typeof mod.hireCommand === 'function') {
      await mod.hireCommand(ctx.workspaceRoot, {});
    }
    await ctx.agentManager.refreshAsync();
  }
}
