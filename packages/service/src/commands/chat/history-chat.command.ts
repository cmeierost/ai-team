import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class HistoryChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'history';
  readonly usage = '/history [n]';
  readonly description = 'Show recent messages (default: 20)';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const parsedLimit = Number.parseInt(args.trim(), 10);
    const limit = Number.isNaN(parsedLimit) ? 20 : parsedLimit;
    const msgs = ctx.history.slice(-limit);
    if (msgs.length === 0) {
      write(ctx, 'No messages in this session.');
      return;
    }
    write(ctx, `\n─── Last ${msgs.length} messages ─────────────────────────────────`);
    for (const m of msgs) {
      const who = m.isHuman ? 'You' : ctx.agent.name;
      const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '?';
      write(ctx, `[${ts}] ${who}: ${String(m.content).slice(0, 300)}`);
    }
    write(ctx, '──────────────────────────────────────────────────────────\n');
  }
}
