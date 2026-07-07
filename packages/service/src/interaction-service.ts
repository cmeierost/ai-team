import type {
  ChatOptions,
  CommandResponse,
  StreamEvent,
  InteractionRequest,
  WorkflowStateSnapshot,
} from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';
import type { ChatRuntimeHooks } from './commands/chat/index.js';
import { runtimeEventToStreamEvent } from './runtime-event-translator.js';
import { InteractionStream } from './interaction-stream.js';
import type { IEmitService } from './orchestrator/services/emit-service.js';

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
    hooks?: ChatRuntimeHooks
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

  async *stream<TCommand extends string = string>(
    request: InteractionRequest,
    hooks: ChatRuntimeHooks = {}
  ): AsyncIterable<StreamEvent<TCommand>> {
    if (request.command !== 'chat') {
      throw new Error(`Unsupported stream command: ${request.command}`);
    }

    const payload = request.payload as { employeeId?: string; options: ChatOptions };

    const context: ExecutionContext = {
      workspaceRoot: this.workspaceRoot,
      history: [],
      invocationSurface: hooks.invocationSurface,
      signal: hooks.signal,
      workflowState: hooks.workflowState,
      onWorkflowFrame: hooks.onWorkflowFrame as ((frame: unknown) => void) | undefined,
    };

    const interactionStream = new InteractionStream({ translateRuntimeEvent: runtimeEventToStreamEvent });
    yield* interactionStream.stream({
      request,
      context: context as unknown as Record<string, unknown>,
      invoke: async (invokeCtx: ExecutionContext, emitService: IEmitService) => {
        await this.runChat(this.workspaceRoot, payload.employeeId, payload.options, {
          ...hooks,
          emitService,
          signal: invokeCtx.signal,
          workflowState: invokeCtx.workflowState as WorkflowStateSnapshot | undefined,
          onWorkflowFrame: invokeCtx.onWorkflowFrame,
        });

        return { status: 'ok' as const, message: '' } satisfies CommandResponse<void>;
      },
    });
  }
}
