import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class PortfolioChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'portfolio';
  readonly aliases = ['bio'];
  readonly description = "Show current agent's bio and tools";
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(_args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const a = ctx.agent;
    write(ctx, `\n${a.name} (${a.role}).`);
    if ((a as any).bio) write(ctx, '\n' + (a as any).bio);
    if ((a as any).tools?.length) write(ctx, '\nTools: ' + (a as any).tools.join(', '));
    write(ctx, '');
  }
}
