import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { SessionManager } from '../../session-manager.js';
import type { StoredMessage } from './context-utils.js';

function formatMessageEntry(m: StoredMessage): string[] {
  const who = m.isHuman ? 'You' : (m.from ?? 'agent');
  const hiddenLabel = m.hiddenFromLlm ? 'hidden' : 'visible';
  const archivedLabel = m.archived ? 'archived' : 'active';
  const toolCount = m.tool_calls?.length ?? 0;
  const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : '?';
  const toolSuffix = toolCount > 0 ? `  tools:${toolCount}` : '';
  const header = `#${m.id ?? '?'}  ${ts}  ${who}  [${hiddenLabel}, ${archivedLabel}]${toolSuffix}`;
  const preview = `    ${String(m.content).replaceAll('\n', ' ').slice(0, 180)}`;
  const toolLines = (m.tool_calls ?? []).map((tc) => `    ↳ toolCall#${tc.id ?? '?'} ${tc.tool}`);
  return [header, preview, ...toolLines];
}

export class ContextListChatCommand implements ICommand<string, string> {
  readonly key = 'context-list';
  readonly usage = '/context list';
  readonly description = 'List all persisted messages with their LLM context visibility status';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  constructor(private readonly sessionManager: Pick<SessionManager, 'listSessionMessages'>) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const allMessages = (await this.sessionManager.listSessionMessages(
      ctx.sessionId!
    )) as StoredMessage[];

    if (allMessages.length === 0) {
      return {
        status: 'ok',
        message: 'No persisted messages in this session yet.',
        data: 'No persisted messages in this session yet.',
      };
    }

    const lines: string[] = [
      `\n─── Context messages (${allMessages.length}) ─────────────────────────────`,
      ...allMessages.flatMap(formatMessageEntry),
      '──────────────────────────────────────────────────────────\n',
    ];

    const text = lines.join('\n');
    return { status: 'ok', message: text, data: text };
  }
}
