import { format as formatMessage } from 'node:util';
import type {
  RuntimeStreamEvent,
  ToolDenialEvent,
  ToolRuntimePayloadEvent,
} from '@ai-team/api-contracts';

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
export interface ChatCommandEmitter {
  write(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  event(event: RuntimeStreamEvent): void;
}

export interface IEmitService extends ChatCommandEmitter {
  emit(event: RuntimeStreamEvent): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  status(phase: string, message?: string): void;
  token(text: string): void;
  toolEvent(
    toolName: string,
    toolCallId: string | undefined,
    toolPhase: 'start' | 'result' | 'error' | 'denied',
    message?: string,
    toolDenial?: ToolDenialEvent,
    toolResult?: ToolRuntimePayloadEvent
  ): void;
}

/**
 * Per-connection event emitter.
 * Construct at connection time; the DI container provides per-connection
 * isolation via a scoped child container — no AsyncLocalStorage needed.
 */
export class EmitService implements IEmitService {
  constructor(private readonly emitter: (event: RuntimeStreamEvent) => void) {}

  emit(event: RuntimeStreamEvent): void {
    this.emitter(event);
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
      if (event.kind === 'token' && 'text' in event && (event as { text?: string }).text) {
        process.stdout.write((event as { text: string }).text);
      } else if (event.kind === 'log' && 'message' in event) {
        const { level, message } = event as { level: string; message: string };
        if (level === 'error') {
          process.stderr.write(`${message}\n`);
        } else {
          process.stdout.write(`${message}\n`);
        }
      }
    });
  }
}
