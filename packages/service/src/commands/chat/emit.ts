/**
 * Runtime event emission and structured logging.
 * These wrap the hook's emit() and fall back to raw stdout/stderr for CLI.
 */
import { format as formatMessage } from 'util';
import type { ChatMessage } from '@ai-team/infrastructure';
import type { ChatRuntimeHooks } from './hooks.js';
import type { RuntimeStreamEvent } from '@ai-team/api-client';

export function emitRuntimeEvent(
  hooks: ChatRuntimeHooks | undefined,
  event: RuntimeStreamEvent
): void {
  hooks?.emit?.(event);
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

export function writeInfo(hooks: ChatRuntimeHooks | undefined, message: string): void {
  emitRuntimeEvent(hooks, { kind: 'log', level: 'info', message });
  if (!hooks?.emit) process.stdout.write(`${message}\n`);
}

export function writeWarn(hooks: ChatRuntimeHooks | undefined, message: string): void {
  emitRuntimeEvent(hooks, { kind: 'log', level: 'warn', message });
  if (!hooks?.emit) process.stdout.write(`${message}\n`);
}

export function writeError(hooks: ChatRuntimeHooks | undefined, message: string): void {
  emitRuntimeEvent(hooks, { kind: 'log', level: 'error', message });
  if (!hooks?.emit) process.stderr.write(`${message}\n`);
}

/**
 * Replay previous conversation messages to the terminal when resuming a session.
 * Skips archived messages, handoff briefings, and low-importance entries.
 */
export function printSessionResume(
  history: ChatMessage[],
  agentName: string,
  developerName: string | undefined,
  hooks: ChatRuntimeHooks | undefined
): void {
  const visible = history.filter((m) => !m.archived && !m.handoffType && m.importance !== 'low');
  if (visible.length === 0) return;

  writeInfo(hooks, '\n─── Previous conversation ───────────────────────────────');
  for (const msg of visible) {
    const speaker = msg.isHuman ? (developerName ?? 'You') : agentName;
    const lines = msg.content
      .split('\n')
      .flatMap((line: string) =>
        line.length <= 100 ? [line] : (line.match(/.{1,100}(\s|$)/g) ?? [line])
      )
      .map((l: string, i: number) => (i === 0 ? l : `  ${l}`))
      .join('\n');
    writeInfo(hooks, `\n${speaker}: ${lines}`);
  }
  writeInfo(hooks, '\n─────────────────────────────────────────────────────────\n');
}
