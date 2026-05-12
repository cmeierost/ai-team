import { format as formatMessage } from 'node:util';
import type { ChatMessage } from '@ai-team/core';
import type { RuntimeStreamEvent } from '@ai-team/api-contracts';
import { emitLog, emitEvent } from './stream-events.js';
import type { ChatRuntimeHooks } from './hooks.js';

// ── Minimal sink abstraction ──────────────────────────────────────────────────

/** Minimal context needed for emission — satisfied by both ChatRuntimeHooks and ExecutionContext. */
export interface EmitSink {
  emit?: (event: RuntimeStreamEvent) => void;
}

export function emitRuntimeEvent(sink: EmitSink | undefined, event: RuntimeStreamEvent): void {
  sink?.emit?.(event);
}

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

export function writeInfo(sink: EmitSink | undefined, message: string): void {
  emitRuntimeEvent(sink, { kind: 'log', level: 'info', message });
  if (!sink?.emit) process.stdout.write(`${message}\n`);
}

export function writeWarn(sink: EmitSink | undefined, message: string): void {
  emitRuntimeEvent(sink, { kind: 'log', level: 'warn', message });
  if (!sink?.emit) process.stdout.write(`${message}\n`);
}

export function writeError(sink: EmitSink | undefined, message: string): void {
  emitRuntimeEvent(sink, { kind: 'log', level: 'error', message });
  if (!sink?.emit) process.stderr.write(`${message}\n`);
}

/**
 * Replay previous conversation messages to the terminal when resuming a session.
 * Skips archived messages, handoff briefings, and low-importance entries.
 */
export function printSessionResume(
  history: ChatMessage[],
  agentName: string,
  developerName: string | undefined,
  sink: EmitSink | undefined
): void {
  const visible = history.filter((m) => !m.archived && !m.handoffType && m.importance !== 'low');
  if (visible.length === 0) return;

  writeInfo(sink, '\n─── Previous conversation ───────────────────────────────');
  for (const msg of visible) {
    const speaker = msg.isHuman ? (developerName ?? 'You') : agentName;
    const lines = msg.content
      .split('\n')
      .flatMap((line: string) =>
        line.length <= 100 ? [line] : (line.match(/.{1,100}(\s|$)/g) ?? [line])
      )
      .map((l: string, i: number) => (i === 0 ? l : `  ${l}`))
      .join('\n');
    writeInfo(sink, `\n${speaker}: ${lines}`);
  }
  writeInfo(sink, '\n─────────────────────────────────────────────────────────\n');
}

// ── ChatCommandEmitter — structured emitter backed by ChatRuntimeHooks ────────

export interface ChatCommandEmitter {
  write(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  event(event: RuntimeStreamEvent): void;
}

export class DefaultChatCommandEmitter implements ChatCommandEmitter {
  constructor(private readonly hooks: ChatRuntimeHooks) {}
  write(message: string): void {
    emitLog(this.hooks, 'info', message);
  }
  warn(message: string): void {
    emitLog(this.hooks, 'warn', message);
  }
  error(message: string): void {
    emitLog(this.hooks, 'error', message);
  }
  event(event: RuntimeStreamEvent): void {
    emitEvent(this.hooks, event);
  }
}
