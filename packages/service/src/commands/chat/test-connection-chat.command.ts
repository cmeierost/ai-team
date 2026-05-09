import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';

export class TestConnectionChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'test-connection';
  readonly description = 'Test LLM provider connectivity';
  readonly availableIn = { chat: true, tool: true };
  readonly group = 'chat';

  async execute(_args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const mod = (await import('../setup/test-connection.js')) as any;
    if (typeof mod.testConnectionCommand === 'function') {
      await mod.testConnectionCommand(ctx.workspaceRoot, {});
    }
  }
}
