import { z } from 'zod';
import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IEmitService,
} from '@ai-team/core';
import type { IChatRuntime } from '../../workflow/chat/chat-runtime.js';
import type { IQuestionService } from '../../interaction/question-service.js';

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
    private readonly emitService: IEmitService,
    private readonly questionService: IQuestionService
  ) {}

  async execute(params: ChatParams, _ctx: ExecutionContext): Promise<CommandResponse<string>> {
    if (!params.message) {
      return this.runInteractiveAsync(params);
    }

    const output = await this.runtime.runAsync({
      agentId: params.agentId,
      sessionId: params.sessionId,
      createNewSession: params.createNewSession,
      introduction: params.introduction,
      contextFiles: params.contextFiles,
      message: params.message,
      maxHops: params.maxHops,
      autoReactMessage: params.autoReactMessage,
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

  private async runInteractiveAsync(params: ChatParams): Promise<CommandResponse<string>> {
    while (true) {
      let message: string;
      try {
        message = await this.questionService.input({
          message: 'You: ',
          validate: (value: string) => value.trim().length > 0 || 'Message cannot be empty',
        });
      } catch {
        this.emitService.log('info', 'Goodbye!');
        return {
          status: 'ok',
          message: 'interactive_exit',
          data: '',
        };
      }

      const normalized = message.trim().toLowerCase();
      if (normalized === 'exit') {
        this.emitService.log('info', 'Goodbye!');
        return {
          status: 'ok',
          message: 'interactive_exit',
          data: '',
        };
      }

      const output = await this.runtime.runAsync({
        agentId: params.agentId,
        sessionId: params.sessionId,
        createNewSession: params.createNewSession,
        introduction: params.introduction,
        contextFiles: params.contextFiles,
        message,
        maxHops: params.maxHops,
        autoReactMessage: params.autoReactMessage,
      });

      if (output.status === 'failed') {
        const errorMessage = output.error ?? 'chat runtime failed';
        this.emitService.log('error', errorMessage);
        return {
          status: 'error',
          message: errorMessage,
        };
      }

      if (output.text.trim().length > 0) {
        this.emitService.log('info', output.text);
      }
    }
  }
}
