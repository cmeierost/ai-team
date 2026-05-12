import type { ICommand, CommandResponse, ExecutionContext } from '@ai-team/core';

export class SessionMessagesChatCommand implements ICommand<string, string> {
  readonly key = 'session-messages';
  readonly usage = '/session messages';
  readonly description = 'List all messages in the current session';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const msgs = ctx.history;
    if (msgs.length === 0) {
      return { status: 'ok', message: 'No messages in this session.' };
    }

    const lines: string[] = [
      `\n─── Session messages (${msgs.length}) ─────────────────────────────`,
    ];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const who = m.isHuman ? 'You' : (m.from ?? 'agent');
      const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : '?';
      const toolSuffix = m.tool_calls?.length ? ` [${m.tool_calls.length} tool call(s)]` : '';
      lines.push(
        `[${i + 1}] ${ts}  ${who}${toolSuffix}`,
        `    ${String(m.content).replaceAll('\n', ' ').slice(0, 200)}`
      );
    }
    lines.push('──────────────────────────────────────────────────────────\n');

    const output = lines.join('\n');
    return { status: 'ok', message: output, data: output };
  }
}
