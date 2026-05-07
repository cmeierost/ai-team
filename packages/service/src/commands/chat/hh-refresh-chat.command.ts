import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class HhRefreshChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'hh';
  readonly usage = '/hh refresh';
  readonly description = 'Refresh skill catalog from GitHub';
  readonly availableIn = { chat: true, tool: true };

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const sub = args.trim().toLowerCase();
    if (sub !== 'refresh') {
      write(ctx, 'Usage: /hh refresh');
      return;
    }
    const { hhRefreshCommand } = await import('../hr/hh.js');
    await (hhRefreshCommand as (wr: string) => Promise<void>)(ctx.workspaceRoot);
  }
}
