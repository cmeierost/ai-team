import type {
  CommandResponse,
  StreamEvent,
  InteractionRequest,
} from '@ai-team/api-contracts';
import type { ExecutionContext, IEmitService, RuntimeStreamEvent } from '@ai-team/core';
import { runtimeEventToStreamEvent } from './runtime-event-translator.js';
import { EmitService } from './orchestrator/services/emit-service.js';

export interface InteractionStreamDeps {
  timestamp?: () => string;
  translateRuntimeEvent?: <TCommand extends string>(
    event: RuntimeStreamEvent,
    base: { requestId?: string; command: TCommand; timestamp: string }
  ) => StreamEvent<TCommand> | null;
}

export interface StreamParams<TCommand extends string = string> {
  request: InteractionRequest;
  context?: Record<string, unknown>;
  /**
   * Per-connection EmitService. The stream temporarily rebinds its sink to its
   * per-request queue so events emitted during `invoke()` are correlated with
   * the current request. When omitted, a fresh per-request `EmitService` is
   * constructed (legacy behavior). New callers should always supply this from
   * the connection-scoped DI container.
   */
  emitService?: IEmitService;
  invoke: (ctx: ExecutionContext, emitService: IEmitService) => Promise<CommandResponse<unknown>>;
  normalizeError?: (error: unknown) => Error;
  onRuntimeEvent?: (event: RuntimeStreamEvent) => void;
  onRuntimeEventDequeued?: (event: RuntimeStreamEvent) => void;
  onQueueWait?: (elapsedMs: number) => void;
  onStreamEvent?: (event: StreamEvent<TCommand>) => void;
  onTerminalState?: (state: 'done' | 'error' | 'aborted') => void;
}

function defaultNormalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class InteractionStream {
  private readonly timestamp: () => string;
  private readonly translateRuntimeEventFn: <TCommand extends string>(
    event: RuntimeStreamEvent,
    base: { requestId?: string; command: TCommand; timestamp: string }
  ) => StreamEvent<TCommand> | null;

  constructor(deps: InteractionStreamDeps = {}) {
    this.timestamp = deps.timestamp ?? (() => new Date().toISOString());
    this.translateRuntimeEventFn = deps.translateRuntimeEvent ?? runtimeEventToStreamEvent;
  }

  async *stream<TCommand extends string = string>(
    params: StreamParams<TCommand>
  ): AsyncIterable<StreamEvent<TCommand>> {
    const { request, context = {}, invoke } = params;
    const contextSignal = context['signal'] as AbortSignal | undefined;
    const { timestamp, translateRuntimeEventFn: translateRuntimeEvent } = this;
    const normalizeError = params.normalizeError ?? defaultNormalizeError;
    const command = request.command as TCommand;

    const runtimeQueue: RuntimeStreamEvent[] = [];
    let runtimeWaiter: (() => void) | undefined;
    let data: CommandResponse<unknown> | undefined;
    let invokeError: unknown;
    let invokeSettled = false;
    let terminalStateNotified = false;
    let toolEventSeq = 0;

    const notifyTerminalState = (state: 'done' | 'error' | 'aborted') => {
      if (terminalStateNotified) {
        return;
      }
      terminalStateNotified = true;
      params.onTerminalState?.(state);
    };

    const emitStreamEvent = (event: StreamEvent<TCommand>) => {
      params.onStreamEvent?.(event);
      return event;
    };

    const emitRuntimeEvent = (event: RuntimeStreamEvent) => {
      const enrichedEvent: RuntimeStreamEvent =
        event.kind === 'tool'
          ? {
              ...event,
              toolEventSeq:
                typeof event.toolEventSeq === 'number' && Number.isFinite(event.toolEventSeq)
                  ? event.toolEventSeq
                  : ++toolEventSeq,
            }
          : event;

      params.onRuntimeEvent?.(enrichedEvent);
      runtimeQueue.push(enrichedEvent);
      if (runtimeWaiter) {
        runtimeWaiter();
        runtimeWaiter = undefined;
      }
    };

    if (contextSignal?.aborted) {
      notifyTerminalState('aborted');
      yield emitStreamEvent({
        requestId: request.requestId,
        command,
        kind: 'aborted',
        timestamp: timestamp(),
      });
      return;
    }

    yield emitStreamEvent({
      requestId: request.requestId,
      command,
      kind: 'started',
      timestamp: timestamp(),
    });

    // Per-connection EmitService: rebind its sink to our per-request queue so
    // events emitted during invoke() are correlated with this request. The
    // restore callback returns the sink to its connection-level default when
    // the request completes.
    //
    // When no connection-scoped EmitService was supplied (legacy callers), fall
    // back to constructing a one-off instance bound directly to our queue.
    const restoreSink = params.emitService
      ? params.emitService.bindSink(emitRuntimeEvent)
      : undefined;
    const emitService = params.emitService ?? new EmitService(emitRuntimeEvent);

    invoke(
      {
        ...(context as Partial<ExecutionContext>),
      } as ExecutionContext,
      emitService
    )
      .then((result) => {
        data = result;
      })
      .catch((error) => {
        invokeError = error;
      })
      .finally(() => {
        invokeSettled = true;
        restoreSink?.();
        if (runtimeWaiter) {
          runtimeWaiter();
          runtimeWaiter = undefined;
        }
      });

    while (!invokeSettled || runtimeQueue.length > 0) {
      if (contextSignal?.aborted) {
        notifyTerminalState('aborted');
        yield emitStreamEvent({
          requestId: request.requestId,
          command,
          kind: 'aborted',
          timestamp: timestamp(),
        });
        return;
      }

      if (runtimeQueue.length === 0) {
        const waitStartedAt = Date.now();
        await new Promise<void>((resolve) => {
          const signal = contextSignal;
          const cleanup = () => {
            if (signal) {
              signal.removeEventListener('abort', onAbort);
            }
            if (runtimeWaiter === onRuntimeEvent) {
              runtimeWaiter = undefined;
            }
          };
          const onRuntimeEvent = () => {
            cleanup();
            resolve();
          };
          const onAbort = () => {
            cleanup();
            resolve();
          };

          runtimeWaiter = onRuntimeEvent;

          if (signal) {
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
        params.onQueueWait?.(Date.now() - waitStartedAt);
        continue;
      }

      const runtimeEvent = runtimeQueue.shift();
      if (!runtimeEvent) {
        continue;
      }

      params.onRuntimeEventDequeued?.(runtimeEvent);

      const streamEvent = translateRuntimeEvent(runtimeEvent, {
        requestId: request.requestId,
        command,
        timestamp: timestamp(),
      });
      if (!streamEvent) {
        continue;
      }

      yield emitStreamEvent(streamEvent);
    }

    if (contextSignal?.aborted) {
      notifyTerminalState('aborted');
      yield emitStreamEvent({
        requestId: request.requestId,
        command,
        kind: 'aborted',
        timestamp: timestamp(),
      });
      return;
    }

    if (invokeError) {
      const normalizedError = normalizeError(invokeError);
      notifyTerminalState('error');
      yield emitStreamEvent({
        requestId: request.requestId,
        command,
        kind: 'error',
        timestamp: timestamp(),
        message: normalizedError.message,
      });
      return;
    }

    try {
      yield emitStreamEvent({
        requestId: request.requestId,
        command,
        kind: 'result',
        timestamp: timestamp(),
        data: data ?? { status: 'error' as const, message: 'No result' },
      });
      yield emitStreamEvent({
        requestId: request.requestId,
        command,
        kind: 'done',
        timestamp: timestamp(),
      });
      notifyTerminalState('done');
    } catch (error) {
      const normalizedError = normalizeError(error);
      notifyTerminalState('error');
      yield emitStreamEvent({
        requestId: request.requestId,
        command,
        kind: 'error',
        timestamp: timestamp(),
        message: normalizedError.message,
      });
    }
  }
}

/**
 * Convenience wrapper that calls `new InteractionStream().stream(params)`.
 * Use this when you don't need to inject custom deps (timestamp, translateRuntimeEvent).
 */
export function streamInteraction<TCommand extends string = string>(
  params: StreamParams<TCommand>
): AsyncIterable<StreamEvent<TCommand>> {
  return new InteractionStream().stream(params);
}
