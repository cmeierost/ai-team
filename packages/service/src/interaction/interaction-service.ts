import type {
  ChatOptions,
  CommandResponse,
  StreamEvent,
  InteractionRequest,
  IInteractionService,
  WorkflowCallbacks,
} from '@ai-team/api-contracts';
import type { ExecutionContext, IEmitService } from '@ai-team/core';
import { runtimeEventToStreamEvent } from './runtime-event-translator.js';
import { InteractionStream } from './interaction-stream.js';

// Re-export interface for backward compatibility
export type { IInteractionService } from '@ai-team/api-contracts';

// ─── Default implementation ───────────────────────────────────────────────────

type ChatRunner = (
  workspaceRoot: string,
  agentId: string | undefined,
  options: ChatOptions,
  callbacks: WorkflowCallbacks,
  ctx: ExecutionContext
) => Promise<void>;

export class InteractionService implements IInteractionService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly runChat: ChatRunner,
    private readonly emitService?: IEmitService
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

    const callbackContext = callbacks as WorkflowCallbacks & Partial<ExecutionContext>;

    const options: ChatOptions = {
      message: payload.message,
      sessionId: payload.sessionId,
      createNewSession: payload.createNewSession,
      oneShot: true,
    };

    const context: ExecutionContext = {
      history: [],
      agentId: payload.agentId,
      sessionId: payload.sessionId,
      ...(callbackContext.signal ? { signal: callbackContext.signal } : {}),
      ...(callbackContext.invocationSurface
        ? { invocationSurface: callbackContext.invocationSurface }
        : {}),
      ...(callbackContext.calledByHuman !== undefined
        ? { calledByHuman: callbackContext.calledByHuman }
        : {}),
      ...(callbackContext.workflowState ? { workflowState: callbackContext.workflowState } : {}),
    };

    const interactionStream = new InteractionStream({
      translateRuntimeEvent: runtimeEventToStreamEvent,
    });
    yield* interactionStream.stream({
      request,
      context: context as unknown as Record<string, unknown>,
      emitService: this.emitService,
      invoke: async (invokeCtx: ExecutionContext, _emitService: IEmitService) => {
        await this.runChat(this.workspaceRoot, payload.agentId, options, callbacks, invokeCtx);

        return { status: 'ok' as const, message: '' } satisfies CommandResponse<void>;
      },
    });
  }
}
