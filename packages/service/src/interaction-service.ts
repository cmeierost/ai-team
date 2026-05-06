import type {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  ChatOptions,
  InteractionContext,
  StreamEvent,
  InteractionRequest,
} from '@ai-team/api-contracts';
import type { ChatRuntimeHooks } from './commands/chat/index.js';
import { runtimeEventToStreamEvent } from './runtime-event-translator.js';
import { streamInteraction } from './interaction-stream.js';

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Service-layer streaming interface.
 *
 * All transports (API server WebSocket, CLI, VS Code extension) call
 * `stream()` to drive a chat interaction. Command dispatch and transport I/O
 * remain the caller's concern.
 */
export interface IInteractionService {
  stream<TCommand extends AiTeamCommandName>(
    request: InteractionRequest<TCommand>,
    context?: InteractionContext
  ): AsyncIterable<StreamEvent<TCommand>>;
}

// ─── Default implementation ───────────────────────────────────────────────────

type ChatRunner = (
  workspaceRoot: string,
  agentId: string | undefined,
  options: ChatOptions,
  hooks: ChatRuntimeHooks
) => Promise<void>;

export class InteractionService implements IInteractionService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly runChat: ChatRunner
  ) {}

  async *stream<TCommand extends AiTeamCommandName>(
    request: InteractionRequest<TCommand>,
    context: InteractionContext = {}
  ): AsyncIterable<StreamEvent<TCommand>> {
    if (request.command !== 'chat') {
      throw new Error(`Unsupported stream command: ${request.command}`);
    }

    const payload = request.payload as Extract<
      InteractionRequest<'chat'>['payload'],
      { options: ChatOptions }
    >;

    yield* streamInteraction({
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
