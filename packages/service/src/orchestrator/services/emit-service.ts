import { format as formatMessage } from 'node:util';
import type {
  RuntimeStreamEvent,
  ToolDenialEvent,
  ToolRuntimePayloadEvent,
  IEmitService,
} from '@ai-team/core';

export function formatConsoleArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  if (typeof args[0] === 'string') return formatMessage(args[0], ...args.slice(1));
  return args
    .map((part) => {
      if (typeof part === 'string') return part;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(' ');
}

/** Structural interface for commands that need to write output via the emit pipeline. */

/**
 * Per-connection event emitter.
 * Construct at connection time; the DI container provides per-connection
 * isolation via a scoped child container — no AsyncLocalStorage needed.
 *
 * The sink is mutable so a request-scoped wrapper (e.g. `InteractionStream`)
 * can temporarily route events through its own queue/correlator and restore
 * the connection-level sink when the request completes.
 */
export class EmitService implements IEmitService {
  private emitter: (event: RuntimeStreamEvent) => void;

  constructor(emitter: (event: RuntimeStreamEvent) => void) {
    this.emitter = emitter;
  }

  emit(event: RuntimeStreamEvent): void {
    this.emitter(event);
  }

  /**
   * Replace the current sink and return a restore function.
   *
   * Used by `InteractionStream` to route runtime events through a per-request
   * queue for request/response correlation. The restore callback must be invoked
   * when the request finishes so subsequent emits go back to the connection sink.
   */
  bindSink(sink: (event: RuntimeStreamEvent) => void): () => void {
    const previous = this.emitter;
    this.emitter = sink;
    return () => {
      this.emitter = previous;
    };
  }

  log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit({ kind: 'log', level, message });
  }

  status(phase: string, message?: string): void {
    this.emit({ kind: 'status', phase, message });
  }

  token(text: string): void {
    if (text) this.emit({ kind: 'token', text });
  }

  toolEvent(
    toolName: string,
    toolCallId: string | undefined,
    toolPhase: 'start' | 'result' | 'error' | 'denied',
    message?: string,
    toolDenial?: ToolDenialEvent,
    toolResult?: ToolRuntimePayloadEvent
  ): void {
    this.emit({
      kind: 'tool',
      toolName,
      toolCallId,
      toolPhase,
      message,
      toolDenial,
      toolResult,
    } as RuntimeStreamEvent);
  }

  write(message: string): void {
    this.log('info', message);
  }

  warn(message: string): void {
    this.log('warn', message);
  }

  error(message: string): void {
    this.log('error', message);
  }

  event(e: RuntimeStreamEvent): void {
    this.emit(e);
  }

  /**
   * Console-mode factory for CLI paths. Tokens go to stdout; log messages go
   * to stdout (info/warn) or stderr (error). All other event kinds are dropped.
   */
  static forConsole(): EmitService {
    return new EmitService((event) => {
      const record = event as Record<string, unknown>;
      if (event.kind === 'token' && typeof record.text === 'string' && record.text.length > 0) {
        process.stdout.write(record.text);
      } else if (event.kind === 'log' && typeof record.message === 'string') {
        const level = record.level;
        const message = record.message;
        if (level === 'error') {
          process.stderr.write(`${message}\n`);
        } else {
          process.stdout.write(`${message}\n`);
        }
      }
    });
  }
}
