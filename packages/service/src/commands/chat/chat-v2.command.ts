import { z } from 'zod';
import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IEmitService,
} from '@ai-team/core';
import type { IChatRuntimeV2 } from '../../workflow-v2/chat/chat-runtime.js';
import type { IQuestionService } from '../../questions/question-service.js';

const chatV2ParamsSchema = z.object({
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
  maxHops: z.number().int().nonnegative().optional(),
  autoReactMessage: z.string().optional(),
});

export type ChatV2Params = z.infer<typeof chatV2ParamsSchema>;

export class ChatV2Command implements ICommand<ChatV2Params, string> {
  static readonly metadata = {
    key: 'chat-v2' as const,
    description: 'Run chat using the workflow-v2 runtime',
    availableIn: { cli: true, chat: false, tool: false },
    group: 'chat',
    parameters: chatV2ParamsSchema,
  } satisfies ICommandDescriptor;

  readonly metadata = ChatV2Command.metadata;

  constructor(
    private readonly runtime: IChatRuntimeV2,
    private readonly emitService: IEmitService,
    private readonly questionService: IQuestionService
  ) {}

  async execute(params: ChatV2Params, _ctx: ExecutionContext): Promise<CommandResponse<string>> {
    if (!params.message) {
      return this.runInteractiveAsync(params);
    }

    const output = await this.runtime.runAsync({
      agentId: params.agentId,
      sessionId: params.sessionId,
      message: params.message,
      maxHops: params.maxHops,
      autoReactMessage: params.autoReactMessage,
    });

    if (output.status === 'failed') {
      const errorMessage = output.error ?? 'workflow-v2 chat failed';
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

  private async runInteractiveAsync(params: ChatV2Params): Promise<CommandResponse<string>> {
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
        message,
        maxHops: params.maxHops,
        autoReactMessage: params.autoReactMessage,
      });

      if (output.status === 'failed') {
        const errorMessage = output.error ?? 'workflow-v2 chat failed';
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
