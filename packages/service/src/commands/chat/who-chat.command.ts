import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class WhoChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'who';
  readonly description = 'Show current agent name and session';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(
    _args: string,
    ctx: OrchestratorContext,
    _runtime: CommandRuntime
  ): Promise<void> {
    write(ctx, `\nAgent   : ${ctx.agent.name} (${ctx.agent.role}) [${ctx.agent.id}]`);
    write(ctx, `Session : ${ctx.sessionId}\n`);
  }
}
