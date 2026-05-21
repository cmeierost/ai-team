import {
  createCommandDispatcher,
  type CommandDispatcher,
} from '@ai-team/service/src/command-dispatcher.js';
import type { CommandAvailability, CommandDescriptor } from '@ai-team/api-contracts';
import { toServiceDomainError } from '@ai-team/service/src/errors.js';
import { WorkflowStateStore } from '@ai-team/service/src/workflow-state.js';
import { writeBackendDebugLog } from '@ai-team/service/src/utils/debug-log.js';
import { parseStreamPerfEnv, createStreamPerfTracker } from '@ai-team/service/src/stream-perf.js';
import { runtimeEventToStreamEvent } from '@ai-team/service/src/runtime-event-translator.js';
import { streamInteraction } from '@ai-team/service/src/interaction-stream.js';
import type { IServiceContainer } from '@ai-team/core';
import {
  CommandResponse,
  InteractionContext,
  StreamEvent,
  InteractionRequest,
  RuntimeStreamEvent,
} from '@ai-team/api-contracts';

import { AsyncLocalStorage } from 'node:async_hooks';

const STDOUT_CAPTURE_SCOPE = new AsyncLocalStorage<boolean>();
const STDOUT_CAPTURE_BYPASS_SCOPE = new AsyncLocalStorage<boolean>();

function runWithoutStdoutCapture<T>(task: () => Promise<T>): Promise<T> {
  return STDOUT_CAPTURE_BYPASS_SCOPE.run(true, task);
}

type CliEmit = ((event: RuntimeStreamEvent) => void) | undefined;

function wrapQuestionHandler<TRequest, TResponse>(
  handler: ((request: TRequest) => Promise<TResponse>) | undefined
): ((request: TRequest) => Promise<TResponse>) | undefined {
  if (!handler) {
    return undefined;
  }

  return (request: TRequest) => runWithoutStdoutCapture(() => handler(request));
}

export interface ICliInteractionContextAdapter {
  adapt(command: string, context: InteractionContext, emitWithConsole: CliEmit): InteractionContext;
}

/**
 * Default request-scoped adapter for CLI interaction context.
 *
 * This is DI-friendly: callers may provide an alternate implementation when
 * they need different runtime bridging behavior.
 */
export class DefaultCliInteractionContextAdapter implements ICliInteractionContextAdapter {
  constructor(private readonly workspaceRoot: string) {}

  adapt(
    command: string,
    context: InteractionContext,
    emitWithConsole: CliEmit
  ): InteractionContext {
    const isInteractive = command === 'chat' || command === 'init';

    const workflowStateStore = isInteractive
      ? new WorkflowStateStore(this.workspaceRoot)
      : undefined;
    const persistedWorkflowState = workflowStateStore?.loadForCommand(command);

    return {
      ...context,
      signal: context.signal,
      emit: emitWithConsole,
      logger: context.logger,
      input: wrapQuestionHandler(context.input),
      confirm: wrapQuestionHandler(context.confirm),
      select: wrapQuestionHandler(context.select),
      questionPassword: wrapQuestionHandler(context.questionPassword),
      questionChecklist: wrapQuestionHandler(context.questionChecklist),
      workflowState: context.workflowState || persistedWorkflowState,
      onWorkflowFrame: workflowStateStore
        ? (frame) => {
            workflowStateStore.handleFrame(command, frame);
            context.onWorkflowFrame?.(frame);
          }
        : context.onWorkflowFrame,
    };
  }
}

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
    context?: InteractionContext
  ): AsyncIterable<StreamEvent<TCommand>>;
  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[];
}

export class CliCommandClient implements ICliCommandClient {
  public readonly workspaceRoot: string;
  private readonly dispatcher: CommandDispatcher;
  private readonly contextAdapter: ICliInteractionContextAdapter;

  constructor(
    workspaceRoot: string,
    resolver: IServiceContainer,
    contextAdapter: ICliInteractionContextAdapter = new DefaultCliInteractionContextAdapter(
      workspaceRoot
    )
  ) {
    this.workspaceRoot = workspaceRoot;
    this.dispatcher = createCommandDispatcher(workspaceRoot, resolver);
    this.contextAdapter = contextAdapter;
  }

  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[] {
    return this.dispatcher.getCommands(filter);
  }

  async invokeTool(
    request: InteractionRequest,
    context: InteractionContext = {}
  ): Promise<CommandResponse<unknown>> {
    if (context.signal?.aborted) {
      throw new Error('Mediator invocation aborted');
    }

    context.emit?.({
      kind: 'status',
      phase: 'dispatch',
      message: `Dispatching command '${request.command}'`,
    });
    writeBackendDebugLog(this.workspaceRoot, {
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

    // Wrap emit so every event reaches the client via the event queue.
    // Do NOT mirror log events back to console.log/warn/error here:
    // originalLog still calls process.stdout.write (which is patched when
    // context.emit is present), so mirroring would emit a second token event
    // for every log message and cause double-printing in the CLI.
    const emitWithConsole: ((event: RuntimeStreamEvent) => void) | undefined = context.emit
      ? (event: RuntimeStreamEvent) => {
          context.emit!(event);
        }
      : undefined;

    if (context.emit) {
      console.log = (...args: unknown[]) => {
        emitWithConsole!({
          kind: 'log',
          level: 'info',
          message: formatRuntimeConsoleArgs(args),
        });
      };

      console.warn = (...args: unknown[]) => {
        emitWithConsole!({
          kind: 'log',
          level: 'warn',
          message: formatRuntimeConsoleArgs(args),
        });
      };

      console.error = (...args: unknown[]) => {
        emitWithConsole!({
          kind: 'log',
          level: 'error',
          message: formatRuntimeConsoleArgs(args),
        });
      };

      process.stdout.write = ((
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

        const text =
          typeof chunk === 'string'
            ? chunk
            : Buffer.isBuffer(chunk)
              ? chunk.toString(typeof encoding === 'string' ? encoding : undefined)
              : String(chunk);

        emitWithConsole!({
          kind: 'token',
          text,
        });

        if (typeof encoding === 'function') {
          encoding(null);
          return true;
        }
        if (cb) {
          cb(null);
        }
        return true;
      }) as typeof process.stdout.write;
    }

    const invokeCore = async (): Promise<CommandResponse<unknown>> => {
      // Build a CLI-adapted context that wraps question callbacks with
      // runWithoutStdoutCapture (so interactive prompts bypass the stdout
      // capture scope) and wires up workflow state persistence for
      // interactive commands (chat, init).
      const dispatchContext = this.contextAdapter.adapt(request.command, context, emitWithConsole);

      const response = await this.dispatcher.dispatch(request, dispatchContext);

      context.emit?.({
        kind: 'status',
        phase: 'completed',
        message: `Completed command '${request.command}'`,
      });
      writeBackendDebugLog(this.workspaceRoot, {
        source: 'invoke',
        phase: 'completed',
        command: request.command,
        requestId: request.requestId,
      });

      return response as CommandResponse<unknown>;
    };

    try {
      return context.emit ? await STDOUT_CAPTURE_SCOPE.run(true, invokeCore) : await invokeCore();
    } catch (error) {
      const serviceError = toServiceDomainError(error, `Command '${request.command}' failed.`);
      writeBackendDebugLog(this.workspaceRoot, {
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
      emitWithConsole?.({
        kind: 'log',
        level: 'error',
        message: serviceError.message,
      });
      throw serviceError;
    } finally {
      if (context.emit) {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
      }
    }
  }

  async *streamInteraction<TCommand extends string = string>(
    request: InteractionRequest,
    context: InteractionContext = {}
  ): AsyncIterable<StreamEvent<TCommand>> {
    const { enabled: perfEnabled, slowMs: perfSlowMs } = parseStreamPerfEnv();
    const perf = perfEnabled
      ? createStreamPerfTracker(this.workspaceRoot, request.command, request.requestId, perfSlowMs)
      : null;

    // No-op default logger: calling console.log here would trigger a feedback loop
    // because invoke() patches console.log to emit {kind:'log'} runtime events.
    // Each event through passThrough → logger → patched console.log → new log event
    // → passThrough → logger → ... causes the message to grow exponentially via
    // JSON escaping until JSON.stringify throws "Invalid string length" (~5s).
    // Callers that need debug output should pass context.logger explicitly.
    const logger = context.logger ?? (() => {});

    const handleRuntimeEvent = (event: RuntimeStreamEvent) => {
      if (perf) {
        const t0 = perf.nowNs();
        writeBackendDebugLog(this.workspaceRoot, {
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
        writeBackendDebugLog(this.workspaceRoot, {
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
        writeBackendDebugLog(this.workspaceRoot, {
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
        writeBackendDebugLog(this.workspaceRoot, {
          source: 'stream',
          command: request.command,
          requestId: request.requestId,
          event,
        });
        logger({ channel: 'stream', event });
      }
    };
    yield* streamInteraction({
      request,
      context,
      invoke: (invokeContext: InteractionContext) => this.invokeTool(request, invokeContext),
      translateRuntimeEvent: runtimeEventToStreamEvent,
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
