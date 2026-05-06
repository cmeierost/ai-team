import type {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  InteractionContext,
  StreamEvent,
  InteractionRequest,
  RuntimeStreamEvent,
} from '@ai-team/api-contracts';
import { runtimeEventToStreamEvent } from './runtime-event-translator.js';

export interface StreamInteractionOptions<
  TCommand extends AiTeamCommandName & keyof AiTeamCommandResponseMap,
> {
  request: InteractionRequest<TCommand>;
  context?: InteractionContext;
  invoke: (context: InteractionContext) => Promise<AiTeamCommandResponseMap[TCommand]>;
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

export async function* streamInteraction<
  TCommand extends AiTeamCommandName & keyof AiTeamCommandResponseMap,
>(options: StreamInteractionOptions<TCommand>): AsyncIterable<StreamEvent<TCommand>> {
  const context = options.context ?? {};
  const timestamp = options.timestamp ?? (() => new Date().toISOString());
  const translateRuntimeEvent = options.translateRuntimeEvent ?? runtimeEventToStreamEvent;
  const normalizeError = options.normalizeError ?? defaultNormalizeError;

  const runtimeQueue: RuntimeStreamEvent[] = [];
  let runtimeWaiter: (() => void) | undefined;
  let data: AiTeamCommandResponseMap[TCommand] | undefined;
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

  if (context.signal?.aborted) {
    notifyTerminalState('aborted');
    yield emitStreamEvent({
      requestId: options.request.requestId,
      command: options.request.command,
      kind: 'aborted',
      timestamp: timestamp(),
    });
    return;
  }

  yield emitStreamEvent({
    requestId: options.request.requestId,
    command: options.request.command,
    kind: 'started',
    timestamp: timestamp(),
  });

  options
    .invoke({ ...context, emit: emitRuntimeEvent })
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
    if (context.signal?.aborted) {
      notifyTerminalState('aborted');
      yield emitStreamEvent({
        requestId: options.request.requestId,
        command: options.request.command,
        kind: 'aborted',
        timestamp: timestamp(),
      });
      return;
    }

    if (runtimeQueue.length === 0) {
      const waitStartedAt = Date.now();
      await new Promise<void>((resolve) => {
        const signal = context.signal;
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
      command: options.request.command,
      timestamp: timestamp(),
    });
    if (!streamEvent) {
      continue;
    }

    yield emitStreamEvent(streamEvent);
  }

  if (context.signal?.aborted) {
    notifyTerminalState('aborted');
    yield emitStreamEvent({
      requestId: options.request.requestId,
      command: options.request.command,
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
      command: options.request.command,
      kind: 'error',
      timestamp: timestamp(),
      message: normalizedError.message,
    });
    return;
  }

  try {
    yield emitStreamEvent({
      requestId: options.request.requestId,
      command: options.request.command,
      kind: 'result',
      timestamp: timestamp(),
      data: data as AiTeamCommandResponseMap[TCommand],
    });
    yield emitStreamEvent({
      requestId: options.request.requestId,
      command: options.request.command,
      kind: 'done',
      timestamp: timestamp(),
    });
    notifyTerminalState('done');
  } catch (error) {
    const normalizedError = normalizeError(error);
    notifyTerminalState('error');
    yield emitStreamEvent({
      requestId: options.request.requestId,
      command: options.request.command,
      kind: 'error',
      timestamp: timestamp(),
      message: normalizedError.message,
    });
  }
}
