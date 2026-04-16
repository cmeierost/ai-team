import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { LlmChatOptions } from './index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
}

interface LlmLogBase {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  mode: 'chat' | 'stream' | 'raw-chat' | 'raw-stream';
  agent?: {
    id: string;
    name: string;
    role: string;
  };
  request: {
    messages: ChatCompletionMessageParam[];
    options?: LlmChatOptions;
    skills?: {
      name: string;
      filePath: string;
    }[];
    teamRoster?: {
      id: string;
      name: string;
      role: string;
    }[];
  };
}

export interface LlmLogPayload extends LlmLogBase {
  durationMs?: number;
  response?: {
    text?: string;
    raw?: unknown;
  };
  error?: SerializedError;
}

// ── ANSI colours ──────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isLlmConsoleLogEnabled(): boolean {
  const v = process.env.AI_TEAM_CONSOLE_LOG?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

function llmModeColor(isError: boolean, mode: string): string {
  if (isError) return C.red;
  if (mode.startsWith('stream')) return C.cyan;
  return C.reset;
}

function extractUserContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c: unknown) => {
      const part = c as Record<string, unknown>;
      return part.type === 'text' && typeof part.text === 'string' ? part.text : '';
    })
    .join('');
}

function writeLlmHeader(payload: LlmLogPayload): void {
  const time = new Date(payload.timestamp).toISOString().slice(11, 19);
  const agentLabel = payload.agent?.name ?? 'system';
  const model = payload.model ?? '?';
  const mode = payload.mode ?? '?';
  const isFallbackWarning =
    Boolean(payload.error) &&
    !!(payload.response?.raw &&
      typeof payload.response.raw === 'object' &&
      (payload.response.raw as { mode?: string }).mode === 'fallback');
  const isError = Boolean(payload.error) && !isFallbackWarning;
  const durationMs = payload.durationMs;
  const durationLabel = durationMs === undefined ? '' : ` ${durationMs}ms`;
  const modeColor = llmModeColor(isError, mode);
  const statusColor = isError ? C.red : isFallbackWarning ? C.cyan : C.green;
  const statusLabel = isError ? 'error' : isFallbackWarning ? 'warning' : 'done';

  const parts = [
    `${C.gray}${time}${C.reset}`,
    `${C.dim}[llm:${mode}]${C.reset}`,
    `${C.bold}${agentLabel}${C.reset}`,
    `${modeColor}→ ${model}${C.reset}`,
    `${statusColor}${statusLabel}${C.reset}`,
    `${C.dim}${durationLabel}${C.reset}`,
  ].filter(Boolean);
  process.stderr.write(parts.join(' ') + '\n');
}

function writeLlmUserPreview(payload: LlmLogPayload): void {
  const messages = payload.request?.messages ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return;
  const content = extractUserContent(lastUser.content);
  const preview = content.slice(0, 120).replaceAll('\n', ' ');
  const ellipsis = content.length > 120 ? '…' : '';
  process.stderr.write(`  ${C.gray}user:${C.reset} ${C.white}${preview}${ellipsis}${C.reset}\n`);
}

function writeLlmReplyPreview(payload: LlmLogPayload): void {
  const responseText = typeof payload.response?.text === 'string' ? payload.response.text : '';
  if (!responseText) return;
  const preview = responseText.slice(0, 200).replaceAll('\n', ' ');
  const ellipsis = responseText.length > 200 ? '…' : '';
  process.stderr.write(`  ${C.gray}reply:${C.reset} ${C.green}${preview}${ellipsis}${C.reset}\n`);
}

function writeLlmError(payload: LlmLogPayload): void {
  if (!payload.error) return;
  const errMsg = payload.error.message ?? JSON.stringify(payload.error);
  const isFallbackWarning =
    !!(payload.response?.raw &&
      typeof payload.response.raw === 'object' &&
      (payload.response.raw as { mode?: string }).mode === 'fallback');
  if (isFallbackWarning) {
    process.stderr.write(`  ${C.cyan}warning: ${errMsg}${C.reset}\n`);
    return;
  }
  process.stderr.write(`  ${C.red}error: ${errMsg}${C.reset}\n`);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function writeLlmLogToConsole(payload: LlmLogPayload): void {
  try {
    writeLlmHeader(payload);
    writeLlmUserPreview(payload);
    writeLlmReplyPreview(payload);
    writeLlmError(payload);
  } catch {
    // Console logging must never break LLM flow.
  }
}
