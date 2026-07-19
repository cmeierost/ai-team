import { z } from 'zod';
import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
} from '@ai-team/core';
import type { IChatRuntime } from '../../workflow/chat/index.js';

const chatTurnParamsSchema = z.object({
  employeeId: z.string().optional(),
  options: z.object({
    message: z.string().min(1),
    sessionId: z.string().optional(),
    createNewSession: z.boolean().optional(),
    introduction: z.boolean().optional(),
    contextFiles: z.array(z.string()).optional(),
    suppressAutoIntroduction: z.boolean().optional(),
    disableProcessExit: z.boolean().optional(),
  }),
});

type ChatTurnParams = z.infer<typeof chatTurnParamsSchema>;

export class ChatTurnCommand implements ICommand<ChatTurnParams, string> {
  static readonly metadata = {
    key: 'chat-turn' as const,
    description: 'Execute one chat turn through the shared chat runtime bridge',
    availableIn: { cli: false, chat: false, tool: false },
    group: 'chat',
    parameters: chatTurnParamsSchema,
  } satisfies ICommandDescriptor;

  readonly metadata = ChatTurnCommand.metadata;

  constructor(private readonly runtime: IChatRuntime) {}

  async execute(payload: ChatTurnParams, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const output = await this.runtime.runAsync({
      agentId: payload.employeeId,
      sessionId: payload.options.sessionId,
      createNewSession: payload.options.createNewSession,
      introduction:
        payload.options.introduction ?? payload.options.suppressAutoIntroduction !== true,
      contextFiles: payload.options.contextFiles,
      message: payload.options.message,
      maxHops: 0,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    if (output.status === 'failed') {
      return {
        status: 'error',
        message: output.error ?? 'chat turn failed',
      };
    }

    return { status: 'ok', data: output.text, message: 'completed' };
  }
}
