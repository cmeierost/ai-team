import type {
  CommandAvailability,
  CommandDescriptor,
  CommandResponse,
  InteractionRequest,
  IInteractionService,
  StreamEvent,
} from '@ai-team/api-contracts';
import {
  type IEmitService,
  type ExecutionContext,
  type IBackendLogService,
  ICommandDispatcher,
} from '@ai-team/core';

import {
  parseStreamPerfEnv,
  createStreamPerfTracker,
  runtimeEventToStreamEvent,
  InteractionStream,
  toServiceDomainError,
} from '@ai-team/service';

import { AsyncLocalStorage } from 'node:async_hooks';

const STDOUT_CAPTURE_SCOPE = new AsyncLocalStorage<boolean>();
const STDOUT_CAPTURE_BYPASS_SCOPE = new AsyncLocalStorage<boolean>();

function formatRuntimeConsoleArgs(args: unknown[]): string {
  if (args.length === 0) {
    return '';
  }

  if (typeof args[0] === 'string') {
    return String(args[0]);
  }

  return args
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(' ');
}

/**
 * Narrow contract for CLI command dispatch.
 * CLI commands only call `streamInteraction()`.
 */
export interface ICliCommandClient {
  streamInteraction<TCommand extends string = string>(
    request: InteractionRequest,
    context?: Record<string, unknown>
  ): AsyncIterable<StreamEvent<TCommand>>;
  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[];
}

export class CliCommandClient implements ICliCommandClient {
  constructor(
    private readonly dispatcher: ICommandDispatcher,
    private readonly emitService: IEmitService,
    private readonly backendLogService: IBackendLogService,
    private readonly interactionService: IInteractionService
  ) {}

  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[] {
    return this.dispatcher.getCommands(filter);
  }

  async invokeTool(
    request: InteractionRequest,
    context: ExecutionContext = {} as ExecutionContext,
    emitService?: IEmitService
  ): Promise<CommandResponse<unknown>> {
    if (context.signal?.aborted) {
      throw new Error('Mediator invocation aborted');
    }

    const svc = emitService;
    const active = Boolean(svc);

    svc?.status('dispatch', `Dispatching command '${request.command}'`);
    this.backendLogService?.write({
      source: 'invoke',
      phase: 'dispatch',
      command: request.command,
      requestId: request.requestId,
      payload: request.payload,
    });

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const isInteractiveChatCommand = request.command === 'chat' || request.command === 'chat-chat';
    const shouldCaptureStdout = active && !isInteractiveChatCommand;

    // Patch console and stdout to route through the active EmitService when present.
    // Do NOT mirror log events back to console.log/warn/error here:
    // originalLog still calls process.stdout.write (which is patched when
    // the emitter is active), so mirroring would emit a second token event
    // for every log message and cause double-printing in the CLI.
    if (active) {
      console.log = (...args: unknown[]) => {
        svc!.emit({ kind: 'log', level: 'info', message: formatRuntimeConsoleArgs(args) });
      };

      console.warn = (...args: unknown[]) => {
        svc!.emit({ kind: 'log', level: 'warn', message: formatRuntimeConsoleArgs(args) });
      };

      console.error = (...args: unknown[]) => {
        svc!.emit({ kind: 'log', level: 'error', message: formatRuntimeConsoleArgs(args) });
      };

      if (shouldCaptureStdout) {
        process.stdout.write = (
          chunk: unknown,
          encoding?: BufferEncoding | ((error?: Error | null) => void),
          cb?: (error?: Error | null) => void
        ) => {
          if (!STDOUT_CAPTURE_SCOPE.getStore() || STDOUT_CAPTURE_BYPASS_SCOPE.getStore()) {
            if (typeof encoding === 'function') {
              return originalStdoutWrite(chunk as never, encoding as never);
            }
            return originalStdoutWrite(chunk as never, encoding as never, cb as never);
          }

          let text: string;
          if (typeof chunk === 'string') {
            text = chunk;
          } else if (Buffer.isBuffer(chunk)) {
            text = chunk.toString(typeof encoding === 'string' ? encoding : undefined);
          } else {
            text = String(chunk);
          }

          svc!.emit({ kind: 'token', text });

          if (typeof encoding === 'function') {
            encoding(null);
            return true;
          }
          if (cb) {
            cb(null);
          }
          return true;
        };
      }
    }

    const invokeCore = async (): Promise<CommandResponse<unknown>> => {
      const response = await this.dispatcher.dispatch(
        request.command,
        request.payload,
        context
      );

      svc?.status('completed', `Completed command '${request.command}'`);
      this.backendLogService?.write({
        source: 'invoke',
        phase: 'completed',
        command: request.command,
        requestId: request.requestId,
      });

      return response;
    };

    try {
      return active ? await STDOUT_CAPTURE_SCOPE.run(true, invokeCore) : await invokeCore();
    } catch (error) {
      const serviceError = toServiceDomainError(error, `Command '${request.command}' failed.`);
      this.backendLogService?.write({
        source: 'invoke',
        phase: 'error',
        command: request.command,
        requestId: request.requestId,
        error: {
          message: serviceError.message,
          code: serviceError.code,
          details: serviceError.details,
        },
      });
      if (svc) {
        svc.log('error', serviceError.message);
      } else {
        process.stderr.write(`${serviceError.message}\n`);
      }
      throw serviceError;
    } finally {
      if (active) {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        if (shouldCaptureStdout) {
          process.stdout.write = originalStdoutWrite;
        }
      }
    }
  }

  async *streamInteraction<TCommand extends string = string>(
    request: InteractionRequest,
    context: Record<string, unknown> = {}
  ): AsyncIterable<StreamEvent<TCommand>> {
    const { enabled: perfEnabled, slowMs: perfSlowMs } = parseStreamPerfEnv();
    const perf = perfEnabled
      ? createStreamPerfTracker(request.command, request.requestId, perfSlowMs, (entry) =>
          this.backendLogService?.write(entry)
        )
      : null;

    // No-op default logger: calling console.log here would trigger a feedback loop
    // because invoke() patches console.log to emit {kind:'log'} runtime events.
    // Each event through passThrough → logger → patched console.log → new log event
    // → passThrough → logger → ... causes the message to grow exponentially via
    // JSON escaping until JSON.stringify throws "Invalid string length" (~5s).
    // Callers that need debug output should pass context.logger explicitly.
    const logger =
      (context.logger as ((entry: { channel: string; event: unknown }) => void) | undefined) ??
      (() => {});

    const handleRuntimeEvent = (event: unknown) => {
      if (perf) {
        const t0 = perf.nowNs();
        this.backendLogService?.write({
          source: 'runtime',
          command: request.command,
          requestId: request.requestId,
          event,
        });
        perf.state.emitRuntimeWriteLogMs += perf.elapsedMs(t0);
        const t1 = perf.nowNs();
        logger({ channel: 'runtime', event });
        perf.state.emitRuntimeLoggerMs += perf.elapsedMs(t1);
        perf.state.runtimeEventsQueued += 1;
      } else {
        this.backendLogService?.write({
          source: 'runtime',
          command: request.command,
          requestId: request.requestId,
          event,
        });
        logger({ channel: 'runtime', event });
      }
    };

    const handleStreamEvent = (event: StreamEvent<TCommand>) => {
      if (perf) {
        const totalStart = perf.nowNs();
        const t0 = perf.nowNs();
        this.backendLogService?.write({
          source: 'stream',
          command: request.command,
          requestId: request.requestId,
          event,
        });
        perf.state.toStreamWriteLogMs += perf.elapsedMs(t0);
        const t1 = perf.nowNs();
        logger({ channel: 'stream', event });
        perf.state.toStreamLoggerMs += perf.elapsedMs(t1);
        const durationMs = perf.elapsedMs(totalStart);
        perf.state.toStreamTotalMs += durationMs;
        perf.state.streamEventsYielded += 1;
        perf.state.byKind[event.kind] = (perf.state.byKind[event.kind] ?? 0) + 1;
        if (durationMs > perf.state.maxToStreamEventMs) {
          perf.state.maxToStreamEventMs = durationMs;
          perf.state.maxToStreamEventKind = event.kind;
        }
        if (durationMs >= perf.slowThresholdMs) perf.state.slowToStreamEventCount += 1;
        perf.logSlowEvent(event.kind, durationMs);
      } else {
        this.backendLogService?.write({
          source: 'stream',
          command: request.command,
          requestId: request.requestId,
          event,
        });
        logger({ channel: 'stream', event });
      }
    };

    if (request.command === 'chat-chat') {
      const hookOptions = {
        invocationSurface: context.invocationSurface as 'cli' | 'web' | 'api' | undefined,
        calledByHuman:
          typeof context.calledByHuman === 'boolean' ? context.calledByHuman : undefined,
        signal: context.signal as AbortSignal | undefined,
        workflowState: context.workflowState,
        onWorkflowFrame: context.onWorkflowFrame,
      };

      for await (const event of this.interactionService.stream(request, hookOptions as any)) {
        handleStreamEvent(event as StreamEvent<TCommand>);
        yield event as StreamEvent<TCommand>;
      }

      perf?.flush('done');
      return;
    }

    const interactionStream = new InteractionStream({
      translateRuntimeEvent: runtimeEventToStreamEvent,
    });
    yield* interactionStream.stream({
      request,
      context: context,
      emitService: this.emitService,
      invoke: (ctx: ExecutionContext, emitService: IEmitService) =>
        this.invokeTool(request, ctx, emitService),
      normalizeError: (error: unknown) =>
        toServiceDomainError(error, `Command '${request.command}' failed.`),
      onRuntimeEvent: handleRuntimeEvent,
      onRuntimeEventDequeued: () => {
        if (perf) {
          perf.state.runtimeEventsDequeued += 1;
        }
      },
      onQueueWait: (elapsedMs: number) => {
        if (perf) {
          perf.state.queueWaitMs += elapsedMs;
        }
      },
      onStreamEvent: handleStreamEvent,
      onTerminalState: (state: 'done' | 'error' | 'aborted') => {
        perf?.flush(state);
      },
    });
  }
}
