/**
 * stream-events.ts — LLM streaming delta extraction + runtime event emission.
 *
 * Keeps knowledge of the raw OpenAI streaming chunk shape in one place.
 * All other modules go through emitEvent() rather than calling hooks.emit directly.
 */

import type {
  RuntimeStreamEvent,
  ToolDenialEvent,
  ToolRuntimePayloadEvent,
} from '@ai-team/api-contracts';
import { getServiceContainer } from '../service-registry.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';
import type { EmitService } from './services/emit-service.js';

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

function getEmitter(): EmitService {
  return getServiceContainer().resolve(COMMAND_FACTORY_TOKENS.EmitService);
}

/** Emit a runtime event through the EmitService, if a listener is registered. */
export function emitEvent(event: RuntimeStreamEvent): void {
  getEmitter().emit(event);
}

export function emitLog(
  level: 'info' | 'warn' | 'error',
  message: string
): void {
  emitEvent({ kind: 'log', level, message });
  if (!getEmitter().hasEmitter()) {
    if (level === 'error') {
      process.stderr.write(`${message}\n`);
    } else {
      process.stdout.write(`${message}\n`);
    }
  }
}

export function emitStatus(
  phase: string,
  message?: string
): void {
  emitEvent({ kind: 'status', phase, message });
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
