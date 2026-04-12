import type {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  ChatOptions,
  IAiTeamMediator,
  MediatorContext,
  MediatorEvent,
  MediatorRequest,
} from '@ai-team/api-client';
import { chatCommand, type ChatRuntimeHooks } from '@ai-team/service/src/commands/chat/index.js';
import { runtimeEventToStreamEvent } from '@ai-team/service/src/runtime-event-translator.js';
import { streamMediatorInteraction } from '@ai-team/service/src/mediator-stream.js';

type ChatRunner = (
  workspaceRoot: string,
  agentId: string | undefined,
  options: ChatOptions,
  hooks: ChatRuntimeHooks
) => Promise<void>;

export class ApiServerMediator implements IAiTeamMediator {
  constructor(
    private readonly workspaceRoot: string,
    private readonly runChat: ChatRunner = chatCommand
  ) {}

  streamChat<TCommand extends AiTeamCommandName>(
    agentId: string,
    message: string,
    options: Omit<{ sessionId?: string }, 'url'> & { sessionId?: string }
  ): AsyncIterable<MediatorEvent<TCommand>> {
    return this.streamInteraction<TCommand>(
      {
        command: 'chat' as TCommand,
        payload: {
          employeeId: agentId,
          options: {
            ...options,
            message,
          },
        } as MediatorRequest<TCommand>['payload'],
      },
      {}
    );
  }

  async invokeTool<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context: MediatorContext = {}
  ): Promise<AiTeamCommandResponseMap[TCommand]> {
    let result: AiTeamCommandResponseMap[TCommand] | undefined;

    for await (const event of this.streamInteraction(request, context)) {
      if (event.kind === 'result') {
        result = event.data;
        continue;
      }
      if (event.kind === 'error') {
        throw new Error(event.message);
      }
      if (event.kind === 'aborted') {
        throw new Error('Mediator invocation aborted');
      }
    }

    return result as AiTeamCommandResponseMap[TCommand];
  }

  async *streamInteraction<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context: MediatorContext = {}
  ): AsyncIterable<MediatorEvent<TCommand>> {
    if (request.command !== 'chat') {
      throw new Error(`Unsupported stream command: ${request.command}`);
    }

    const payload = request.payload as Extract<
      MediatorRequest<'chat'>['payload'],
      { options: ChatOptions }
    >;

    yield* streamMediatorInteraction({
      request,
      context,
      invoke: async (invokeContext) => {
        await this.runChat(this.workspaceRoot, payload.employeeId, payload.options, {
          signal: invokeContext.signal,
          emit: invokeContext.emit,
          questionInput: invokeContext.questionInput,
          questionConfirm: invokeContext.questionConfirm,
          questionSelect: invokeContext.questionSelect,
          questionPassword: invokeContext.questionPassword,
          questionChecklist: invokeContext.questionChecklist,
          workflowState: invokeContext.workflowState,
          onWorkflowFrame: invokeContext.onWorkflowFrame,
        });

        return undefined as AiTeamCommandResponseMap[TCommand];
      },
      translateRuntimeEvent: runtimeEventToStreamEvent,
      onRuntimeEvent: (event) => {
        context.logger?.({ channel: 'runtime', event });
      },
      onStreamEvent: (event) => {
        context.logger?.({ channel: 'stream', event });
      },
    });
  }
}
