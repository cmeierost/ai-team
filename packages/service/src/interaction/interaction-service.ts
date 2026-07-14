import type {
  ChatOptions,
  CommandResponse,
  StreamEvent,
  InteractionRequest,
} from '@ai-team/api-contracts';
import type { ExecutionContext, IEmitService } from '@ai-team/core';
import type { WorkflowCallbacks } from '../workflow/runtime/hooks.js';
import { runtimeEventToStreamEvent } from './runtime-event-translator.js';
import { InteractionStream } from './interaction-stream.js';

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Service-layer streaming interface.
 *
 * All transports (API server WebSocket, CLI, VS Code extension) call
 * `stream()` to drive a chat interaction. Command dispatch and transport I/O
 * remain the caller's concern.
 */
export interface IInteractionService {
  stream<TCommand extends string = string>(
    request: InteractionRequest,
    callbacks?: WorkflowCallbacks
  ): AsyncIterable<StreamEvent<TCommand>>;
}

// ─── Default implementation ───────────────────────────────────────────────────

type ChatRunner = (
  workspaceRoot: string,
  agentId: string | undefined,
  options: ChatOptions,
  callbacks: WorkflowCallbacks
) => Promise<void>;

export class InteractionService implements IInteractionService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly runChat: ChatRunner
  ) {}

  async *stream<TCommand extends string = string>(
    request: InteractionRequest,
    callbacks: WorkflowCallbacks = {}
  ): AsyncIterable<StreamEvent<TCommand>> {
    if (request.command !== 'chat-chat') {
      throw new Error(`Unsupported stream command: ${request.command}`);
    }

    const payload = request.payload as {
      agentId?: string;
      message?: string;
      sessionId?: string;
      createNewSession?: boolean;
    };

    const options: ChatOptions = {
      message: payload.message,
      sessionId: payload.sessionId,
      createNewSession: payload.createNewSession,
      oneShot: true,
    };

    const context: ExecutionContext = {
      history: [],
    };

    const interactionStream = new InteractionStream({
      translateRuntimeEvent: runtimeEventToStreamEvent,
    });
    yield* interactionStream.stream({
      request,
      context: context as unknown as Record<string, unknown>,
      invoke: async (_invokeCtx: ExecutionContext, _emitService: IEmitService) => {
        await this.runChat(this.workspaceRoot, payload.agentId, options, callbacks);

        return { status: 'ok' as const, message: '' } satisfies CommandResponse<void>;
      },
    });
  }
}
