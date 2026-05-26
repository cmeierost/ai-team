import type {
  CommandResponse,
  StreamEvent,
  InteractionRequest,
  RuntimeStreamEvent,
} from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';
import { runtimeEventToStreamEvent } from './runtime-event-translator.js';
import { EmitService } from './orchestrator/services/emit-service.js';
import { runWithEmitter } from './orchestrator/stream-events.js';

export interface StreamInteractionOptions<TCommand extends string = string> {
  request: InteractionRequest;
  context?: Record<string, unknown>;
  invoke: (ctx: ExecutionContext) => Promise<CommandResponse<unknown>>;
  timestamp?: () => string;
  translateRuntimeEvent?: (
    event: RuntimeStreamEvent,
    base: { requestId?: string; command: TCommand; timestamp: string }
  ) => StreamEvent<TCommand> | null;
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

export async function* streamInteraction<TCommand extends string = string>(
  options: StreamInteractionOptions<TCommand>
): AsyncIterable<StreamEvent<TCommand>> {
  const context = options.context ?? {};
  const contextSignal = context['signal'] as AbortSignal | undefined;
  const timestamp = options.timestamp ?? (() => new Date().toISOString());
  const translateRuntimeEvent = options.translateRuntimeEvent ?? runtimeEventToStreamEvent;
  const normalizeError = options.normalizeError ?? defaultNormalizeError;
  const command = options.request.command as TCommand;

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
    options.onTerminalState?.(state);
  };

  const emitStreamEvent = (event: StreamEvent<TCommand>) => {
    options.onStreamEvent?.(event);
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

    options.onRuntimeEvent?.(enrichedEvent);
    runtimeQueue.push(enrichedEvent);
    if (runtimeWaiter) {
      runtimeWaiter();
      runtimeWaiter = undefined;
    }
  };

  if (contextSignal?.aborted) {
    notifyTerminalState('aborted');
    yield emitStreamEvent({
      requestId: options.request.requestId,
      command,
      kind: 'aborted',
      timestamp: timestamp(),
    });
    return;
  }

  yield emitStreamEvent({
    requestId: options.request.requestId,
    command,
    kind: 'started',
    timestamp: timestamp(),
  });

  runWithEmitter(new EmitService(emitRuntimeEvent), () =>
      options.invoke({
        ...(context as Partial<ExecutionContext>),
        emit: emitRuntimeEvent as (event: unknown) => void,
      } as ExecutionContext)
    )
    .then((result) => {
      data = result;
    })
    .catch((error) => {
      invokeError = error;
    })
    .finally(() => {
      invokeSettled = true;
      if (runtimeWaiter) {
        runtimeWaiter();
        runtimeWaiter = undefined;
      }
    });

  while (!invokeSettled || runtimeQueue.length > 0) {
    if (contextSignal?.aborted) {
      notifyTerminalState('aborted');
      yield emitStreamEvent({
        requestId: options.request.requestId,
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
      options.onQueueWait?.(Date.now() - waitStartedAt);
      continue;
    }

    const runtimeEvent = runtimeQueue.shift();
    if (!runtimeEvent) {
      continue;
    }

    options.onRuntimeEventDequeued?.(runtimeEvent);

    const streamEvent = translateRuntimeEvent(runtimeEvent, {
      requestId: options.request.requestId,
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
      requestId: options.request.requestId,
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
      requestId: options.request.requestId,
      command,
      kind: 'error',
      timestamp: timestamp(),
      message: normalizedError.message,
    });
    return;
  }

  try {
    yield emitStreamEvent({
      requestId: options.request.requestId,
      command,
      kind: 'result',
      timestamp: timestamp(),
      data: data ?? { status: 'error' as const, message: 'No result' },
    });
    yield emitStreamEvent({
      requestId: options.request.requestId,
      command,
      kind: 'done',
      timestamp: timestamp(),
    });
    notifyTerminalState('done');
  } catch (error) {
    const normalizedError = normalizeError(error);
    notifyTerminalState('error');
    yield emitStreamEvent({
      requestId: options.request.requestId,
      command,
      kind: 'error',
      timestamp: timestamp(),
      message: normalizedError.message,
    });
  }
}
