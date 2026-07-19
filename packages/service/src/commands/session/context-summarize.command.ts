import type {
  ICommand,
  ITitleGenerator,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  ISessionManager,
} from '@ai-team/core';
import { parseContextArgs, summarizeMessage, type StoredMessage } from './context-utils.js';
export const ContextSummarizeChatCommandMetadata = {
  key: 'summarize',
  usage: '/context summarize [--message <id>] [--instruction <text>]',
  description: 'Summarize a message and replace its content in the LLM context',
  availableIn: { chat: true, tool: false },
  group: 'context',
} satisfies ICommandDescriptor;

export class ContextSummarizeChatCommand implements ICommand<string, string> {
  readonly metadata = ContextSummarizeChatCommandMetadata;

  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly titleGenerator: ITitleGenerator
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
      this.titleGenerator,
      instruction
    );
    ctx.history = await this.sessionManager.getSessionMessages(ctx.sessionId!!);
    const msg = `Summary saved for message #${target.id}:\n\n${summary}`;
    return { status: 'ok', message: msg, data: msg };
  }
}
