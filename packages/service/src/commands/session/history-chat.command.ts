import type { ICommand, CommandResponse, ExecutionContext } from '@ai-team/core';

export class HistoryChatCommand implements ICommand<string, string> {
  readonly key = 'history';
  readonly usage = '/history [n]';
  readonly description = 'Show recent messages (default: 20)';
  readonly availableIn = { chat: false, cliChat: true, tool: false };
  readonly group = 'chat';

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const parsedLimit = Number.parseInt(args.trim(), 10);
    const limit = Number.isNaN(parsedLimit) ? 20 : parsedLimit;
    const msgs = ctx.history.slice(-limit);
    if (msgs.length === 0) {
      return { status: 'ok', message: 'No messages in this session.' };
    }

    const lines: string[] = [
      `\n─── Last ${msgs.length} messages ─────────────────────────────────`,
    ];
    for (const m of msgs) {
      const who = m.isHuman ? 'You' : ctx.agent!.name;
      const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '?';
      lines.push(`[${ts}] ${who}: ${String(m.content).slice(0, 300)}`);
    }
    lines.push('──────────────────────────────────────────────────────────\n');

    const output = lines.join('\n');
    return { status: 'ok', message: output, data: output };
  }
}
