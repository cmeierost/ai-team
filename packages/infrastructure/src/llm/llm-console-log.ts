import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { LlmChatOptions } from '@ai-team/core';

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

export interface ILlmConsoleLog {
  isEnabled(): boolean;
  write(payload: LlmLogPayload): void;
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

export class InfrastructureLlmConsoleLog implements ILlmConsoleLog {
  constructor(
    private readonly isEnabledResolver: () => boolean = InfrastructureLlmConsoleLog.readFromEnv
  ) {}

  isEnabled(): boolean {
    try {
      return this.isEnabledResolver();
    } catch {
      return false;
    }
  }

  private static readFromEnv(): boolean {
    // Only emit LLM console logs when the API server is running.
    // CLI/console runs already stream tokens in real-time — a second
    // summary pass would duplicate output.
    if (process.env.AI_TEAM_RUNTIME_TARGET !== 'api') {
      return false;
    }
    const v = process.env.AI_TEAM_CONSOLE_LOG?.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  }

  write(payload: LlmLogPayload): void {
    try {
      this.writeLlmHeader(payload);
      this.writeLlmUserPreview(payload);
      this.writeLlmReplyPreview(payload);
      this.writeLlmError(payload);
    } catch {
      // Console logging must never break LLM flow.
    }
  }

  private llmModeColor(isError: boolean, mode: string): string {
    if (isError) return C.red;
    if (mode.startsWith('stream')) return C.cyan;
    return C.reset;
  }

  private extractUserContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .map((c: unknown) => {
        const part = c as Record<string, unknown>;
        return part.type === 'text' && typeof part.text === 'string' ? part.text : '';
      })
      .join('');
  }

  private writeLlmHeader(payload: LlmLogPayload): void {
    const time = new Date(payload.timestamp).toISOString().slice(11, 19);
    const agentLabel = payload.agent?.name ?? 'system';
    const model = payload.model ?? '?';
    const mode = payload.mode ?? '?';
    const isFallbackWarning =
      Boolean(payload.error) &&
      !!(
        payload.response?.raw &&
        typeof payload.response.raw === 'object' &&
        (payload.response.raw as { mode?: string }).mode === 'fallback'
      );
    const isError = Boolean(payload.error) && !isFallbackWarning;
    const durationMs = payload.durationMs;
    const durationLabel = durationMs === undefined ? '' : ` ${durationMs}ms`;
    const modeColor = this.llmModeColor(isError, mode);
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

  private writeLlmUserPreview(payload: LlmLogPayload): void {
    const messages = payload.request?.messages ?? [];
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const content = this.extractUserContent(lastUser.content);
    const preview = content.slice(0, 120).replaceAll('\n', ' ');
    const ellipsis = content.length > 120 ? '…' : '';
    process.stderr.write(`  ${C.gray}user:${C.reset} ${C.white}${preview}${ellipsis}${C.reset}\n`);
  }

  private writeLlmReplyPreview(payload: LlmLogPayload): void {
    const responseText = typeof payload.response?.text === 'string' ? payload.response.text : '';
    if (!responseText) return;
    const preview = responseText.slice(0, 200).replaceAll('\n', ' ');
    const ellipsis = responseText.length > 200 ? '…' : '';
    process.stderr.write(`  ${C.gray}reply:${C.reset} ${C.green}${preview}${ellipsis}${C.reset}\n`);
  }

  private writeLlmError(payload: LlmLogPayload): void {
    if (!payload.error) return;
    const errMsg = payload.error.message ?? JSON.stringify(payload.error);
    const isFallbackWarning = !!(
      payload.response?.raw &&
      typeof payload.response.raw === 'object' &&
      (payload.response.raw as { mode?: string }).mode === 'fallback'
    );
    if (isFallbackWarning) {
      process.stderr.write(`  ${C.cyan}warning: ${errMsg}${C.reset}\n`);
      return;
    }
    process.stderr.write(`  ${C.red}error: ${errMsg}${C.reset}\n`);
  }
}
