import type {
  ICommand,
  CommandResponse,
  ExecutionContext,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';
export const SessionInfoChatCommandMetadata = {
  key: 'session',
  group: 'session',
  usage: '/session',
  description: 'Show session info; subcommands: messages, graph, context',
  availableIn: { chat: true, tool: false },
} satisfies ICommandDescriptor;

export class SessionInfoChatCommand implements ICommand<string, string> {
  readonly metadata = SessionInfoChatCommandMetadata;

  constructor(private readonly sessionManager: Pick<SessionManager, 'getSession'>) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const session = await this.sessionManager.getSession(ctx.sessionId!!);
    const msgs = ctx.history;
    const toolCallCount = msgs.reduce((n, m) => n + (m.tool_calls?.length ?? 0), 0);
    const lastMsg = msgs.at(-1);
    const lastMsgTime = lastMsg?.timestamp ? new Date(lastMsg.timestamp).toLocaleString() : 'none';
    const title = session?.title ?? '(untitled)';

    const lines = [
      `\nSession  : ${ctx.sessionId!}`,
      `Title    : ${title}`,
      `Messages : ${msgs.length}`,
      `Tool calls: ${toolCallCount}`,
      `Last msg : ${lastMsgTime}\n`,
    ];

    const output = lines.join('\n');
    return { status: 'ok', message: output, data: output };
  }
}
