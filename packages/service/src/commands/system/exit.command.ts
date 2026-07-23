import type { CommandResponse, ExecutionContext, ICommand, ICommandDescriptor } from '@ai-team/core';

export const ExitChatCommandMetadata = {
  key: 'exit',
  group: 'system',
  aliases: ['exit'],
  description: 'Exit the current chat session',
  summary: 'Exit chat',
  availableIn: { chat: true, cli: false, tool: false },
} satisfies ICommandDescriptor;

export class ExitChatCommand implements ICommand<unknown, string> {
  readonly metadata = ExitChatCommandMetadata;

  async execute(_params: unknown, _ctx: ExecutionContext): Promise<CommandResponse<string>> {
    return {
      status: 'ok',
      message: 'Use /exit (or exit) in the chat prompt to end the conversation.',
      data: 'Use /exit (or exit) in the chat prompt to end the conversation.',
    };
  }
}
