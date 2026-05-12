import type { ICommand, ILlmService, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { SessionManager } from '../../session-manager.js';
import { parseContextArgs, summarizeMessage, type StoredMessage } from './context-utils.js';

export class ContextAddChatCommand implements ICommand<string, string> {
  readonly key = 'context-add';
  readonly usage = '/context add [--message <id>] [--summarized [instruction]]';
  readonly description =
    'Add a message back to LLM context, optionally replacing its content with a summary first';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  constructor(
    private readonly sessionManager: Pick<
      SessionManager,
      | 'listSessionMessages'
      | 'setMessageHiddenFromLlm'
      | 'getSessionMessages'
      | 'summarizeForContextAsync'
      | 'updateToolCallLlmResult'
      | 'updateMessageContent'
    >,
    private readonly llmService: ILlmService
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

    const { messageId, summarizedInstruction, positional } = parsed;
    const hasSummarized = summarizedInstruction !== undefined;

    const allMessages = (await this.sessionManager.listSessionMessages(
      ctx.sessionId!
    )) as StoredMessage[];

    const target = (
      messageId === undefined
        ? [...allMessages]
            .reverse()
            .find((m) => !m.isHuman && !m.archived && m.hiddenFromLlm === true)
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

    if (hasSummarized) {
      const fallback = positional.join(' ').trim();
      const summary = await summarizeMessage(
        target,
        this.sessionManager,
        this.llmService,
        summarizedInstruction || fallback || undefined
      );
      await this.sessionManager.setMessageHiddenFromLlm(target.id, false);
      ctx.history = await this.sessionManager.getSessionMessages(ctx.sessionId!!);
      const msg = `Message #${target.id} added to LLM context with summary:\n\n${summary}`;
      return { status: 'ok', message: msg, data: msg };
    }

    if (target.hiddenFromLlm !== true) {
      const msg = `Message #${target.id} is already included in LLM context.`;
      return { status: 'ok', message: msg, data: msg };
    }

    await this.sessionManager.setMessageHiddenFromLlm(target.id, false);
    ctx.history = await this.sessionManager.getSessionMessages(ctx.sessionId!!);
    const msg = `Message #${target.id} added back to LLM context.`;
    return { status: 'ok', message: msg, data: msg };
  }
}
