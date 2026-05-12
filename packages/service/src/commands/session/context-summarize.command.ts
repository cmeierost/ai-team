import type { ICommand, ILlmService, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { SessionManager } from '../../session-manager.js';
import { parseContextArgs, summarizeMessage, type StoredMessage } from './context-utils.js';

export class ContextSummarizeChatCommand implements ICommand<string, string> {
  readonly key = 'context-summarize';
  readonly usage = '/context summarize [--message <id>] [--instruction <text>]';
  readonly description = 'Summarize a message and replace its content in the LLM context';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  constructor(
    private readonly sessionManager: Pick<
      SessionManager,
      | 'listSessionMessages'
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

    const { messageId, summarizeInstruction, positional } = parsed;

    const allMessages = (await this.sessionManager.listSessionMessages(
      ctx.sessionId!
    )) as StoredMessage[];

    const target = (
      messageId === undefined
        ? [...allMessages].reverse().find((m) => !m.isHuman && !m.archived)
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

    const positionalInstruction = positional.join(' ').trim();
    const instruction = (summarizeInstruction ?? positionalInstruction) || undefined;

    const summary = await summarizeMessage(
      target,
      this.sessionManager,
      this.llmService,
      instruction
    );
    ctx.history = await this.sessionManager.getSessionMessages(ctx.sessionId!!);
    const msg = `Summary saved for message #${target.id}:\n\n${summary}`;
    return { status: 'ok', message: msg, data: msg };
  }
}
