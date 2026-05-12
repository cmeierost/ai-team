import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { SessionManager } from '../../session-manager.js';
import { parseContextArgs, type StoredMessage } from './context-utils.js';

export class ContextRemoveChatCommand implements ICommand<string, string> {
  readonly key = 'context-remove';
  readonly usage = '/context remove [--message <id>]';
  readonly description = 'Hide a message from LLM context';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  constructor(
    private readonly sessionManager: Pick<
      SessionManager,
      'listSessionMessages' | 'setMessageHiddenFromLlm' | 'getSessionMessages'
    >
  ) {}

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    let parsed: ReturnType<typeof parseContextArgs>;
    try {
      parsed = parseContextArgs(args);
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : 'Invalid arguments.',
      };
    }

    const { messageId } = parsed;

    const allMessages = (await this.sessionManager.listSessionMessages(
      ctx.sessionId!
    )) as StoredMessage[];

    const target = (
      messageId === undefined
        ? [...allMessages]
            .reverse()
            .find((m) => !m.isHuman && !m.archived && m.hiddenFromLlm !== true)
        : allMessages.find((m) => m.id === messageId)
    ) as (StoredMessage & { id: number }) | undefined;

    if (target?.id == null) {
      return {
        status: 'error',
        message:
          messageId === undefined
            ? 'No matching message found for this operation.'
            : `Message #${messageId} was not found in this session.`,
      };
    }

    if (target.hiddenFromLlm) {
      const msg = `Message #${target.id} is already hidden from LLM context.`;
      return { status: 'ok', message: msg, data: msg };
    }

    await this.sessionManager.setMessageHiddenFromLlm(target.id, true);
    ctx.history = await this.sessionManager.getSessionMessages(ctx.sessionId!!);
    const msg = `Message #${target.id} is now hidden from LLM context.`;
    return { status: 'ok', message: msg, data: msg };
  }
}
