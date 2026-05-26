/**
 * stream-events.ts — LLM streaming delta extraction + runtime event emission.
 *
 * Keeps knowledge of the raw OpenAI streaming chunk shape in one place.
 * All other modules go through emitEvent() rather than calling hooks.emit directly.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  RuntimeStreamEvent,
  ToolDenialEvent,
  ToolRuntimePayloadEvent,
} from '@ai-team/api-contracts';
import type { IEmitService } from './services/emit-service.js';

// Bridging ALS for code paths not yet wired through DI injection.
const _store = new AsyncLocalStorage<IEmitService | undefined>();

// ── Delta extraction ──────────────────────────────────────────────────────────

type StreamChunk = {
  choices?: Array<{
    delta?: { content?: unknown; reasoning_content?: unknown };
  }>;
};

/**
 * Extract the text delta from a single streaming chunk.
 * Handles string content, array-of-parts content, and reasoning_content.
 */
export function extractStreamDeltaText(chunk: StreamChunk): string {
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) return '';

  const content = extractDeltaSegmentText(delta.content);
  if (content) return content;

  return extractDeltaSegmentText(delta.reasoning_content);
}

function extractDeltaSegmentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';

  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') return text;
      const nested = (part as { content?: unknown }).content;
      return typeof nested === 'string' ? nested : '';
    })
    .join('');
}

// ── Event emission ────────────────────────────────────────────────────────────

function getActiveEmitter(): IEmitService | undefined {
  return _store.getStore();
}

/** Emit a runtime event, if a listener is registered. */
export function emitEvent(event: RuntimeStreamEvent): void {
  getActiveEmitter()?.emit(event);
}

export function emitLog(level: 'info' | 'warn' | 'error', message: string): void {
  emitEvent({ kind: 'log', level, message });
  if (!getActiveEmitter()) {
    if (level === 'error') {
      process.stderr.write(`${message}\n`);
    } else {
      process.stdout.write(`${message}\n`);
    }
  }
}

export function emitStatus(phase: string, message?: string): void {
  emitEvent({ kind: 'status', phase, message });
}

export function emitToken(text: string): void {
  if (!text) return;
  if (getActiveEmitter()) {
    emitEvent({ kind: 'token', text });
    return;
  }
  process.stdout.write(text);
}

export function hasActiveEmitter(): boolean {
  return Boolean(getActiveEmitter());
}

export function runWithEmitter<T>(
  emitter: IEmitService | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return _store.run(emitter, fn);
}

export function getCurrentEmitter(): IEmitService | undefined {
  return getActiveEmitter();
}

export function emitToolEvent(
  toolName: string,
  toolCallId: string | undefined,
  toolPhase: 'start' | 'result' | 'error' | 'denied',
  message?: string,
  toolDenial?: ToolDenialEvent,
  toolResult?: ToolRuntimePayloadEvent
): void {
  emitEvent({
    kind: 'tool',
    toolName,
    toolCallId,
    toolPhase,
    message,
    toolDenial,
    toolResult,
  } as RuntimeStreamEvent);
}
