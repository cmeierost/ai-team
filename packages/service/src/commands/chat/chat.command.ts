import { z } from 'zod';
import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IEmitService,
} from '@ai-team/core';
import type { IChatRuntime } from '../../workflow/chat/chat-runtime.js';

const chatParamsSchema = z.object({
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  createNewSession: z.boolean().optional(),
  introduction: z.boolean().optional(),
  contextFiles: z.array(z.string()).optional(),
  message: z.string().min(1).optional(),
  maxHops: z.number().int().nonnegative().optional(),
  autoReactMessage: z.string().optional(),
});

export type ChatParams = z.infer<typeof chatParamsSchema>;

export class ChatCommand implements ICommand<ChatParams, string> {
  static readonly metadata = {
    key: 'chat' as const,
    description: 'Run chat using the chat runtime',
    availableIn: { cli: true, chat: false, tool: false },
    group: 'chat',
    parameters: chatParamsSchema,
  } satisfies ICommandDescriptor;

  readonly metadata = ChatCommand.metadata;

  constructor(
    private readonly runtime: IChatRuntime,
    private readonly emitService: IEmitService
  ) {}

  async execute(params: ChatParams, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const message = params.message?.trim();
    if (!message) {
      const errorMessage = 'Chat message is required.';
      this.emitService.log('error', errorMessage);
      return {
        status: 'error',
        message: errorMessage,
      };
    }

    const output = await this.runtime.runAsync({
      agentId: params.agentId ?? ctx.agentId,
      sessionId: params.sessionId ?? ctx.sessionId,
      createNewSession: params.createNewSession,
      introduction: params.introduction,
      contextFiles: params.contextFiles,
      message,
      maxHops: params.maxHops,
      autoReactMessage: params.autoReactMessage,
      invocationSurface: ctx.invocationSurface,
      calledByHuman: ctx.calledByHuman,
      callerType: ctx.callerType,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    if (output.status === 'failed') {
      const errorMessage = output.error ?? 'chat runtime failed';
      this.emitService.log('error', errorMessage);
      return {
        status: 'error',
        message: errorMessage,
      };
    }

    return {
      status: 'ok',
      data: output.text,
      message: output.status,
    };
  }
}
