import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  BackendLogRuntimeProfile,
  IBackendDebugLogSettingsService,
  IBackendLogService,
} from '@ai-team/core';

type LogLevel = 'error' | 'warning' | 'info' | 'debug';
type LogOutputLevel = LogLevel | 'off';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

const LOG_DIR = '.ai-team/logs';
const LOG_PREFIX = 'backend-';
const DEFAULT_LOG_FILE = 'backend.log';
const DEFAULT_RETENTION_DAYS = 7;

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

export class InfrastructureBackendLogService implements IBackendLogService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspaceRoot: string,
    private readonly settingsService: IBackendDebugLogSettingsService,
    private readonly runtimeProfileResolver: () => BackendLogRuntimeProfile =
      InfrastructureBackendLogService.resolveRuntimeProfile
  ) {}

  write(entry: unknown): void {
    // Skip streaming token events — they produce high-volume noise and carry no diagnostic value.
    if (this.isTokenEvent(entry)) {
      return;
    }

    const settings = this.settingsService.resolveForRuntime(this.runtimeProfileResolver());
    const entryLevel = this.inferEntryLevel(entry);
    const source = this.extractSource(entry);

    // Resolve effective level: per-source override takes precedence over global level
    const effectiveConsoleLevel = this.resolveEffectiveLevel(
      settings.console,
      settings.sources,
      source
    );
    const effectiveFileLevel = this.resolveEffectiveLevel(
      settings.file,
      settings.sources,
      source
    );

    if (this.shouldWrite(entryLevel, effectiveConsoleLevel)) {
      this.writeToConsole(entry);
    }

    if (!this.shouldWrite(entryLevel, effectiveFileLevel)) {
      return;
    }

    const filePath = this.resolveLogFilePath();
    const payload = {
      timestamp: new Date().toISOString(),
      entry,
    };

    this.writeQueue = this.writeQueue
      .then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
        this.cleanupOldLogs();
      })
      .catch(() => {
        // Logging must never break runtime execution.
      });
  }

  private static resolveRuntimeProfile(): BackendLogRuntimeProfile {
    return process.env.AI_TEAM_RUNTIME_TARGET === 'api' ? 'api' : 'console';
  }

  private isTokenEvent(entry: unknown): boolean {
    const source = (entry ?? {}) as Record<string, unknown>;
    if (source.source !== 'runtime' && source.source !== 'stream') {
      return false;
    }
    const event = (source.event ?? {}) as Record<string, unknown>;
    return event.kind === 'token';
  }

  private shouldWrite(entryLevel: LogLevel, threshold: LogOutputLevel): boolean {
    if (threshold === 'off') {
      return false;
    }
    return LEVEL_ORDER[entryLevel] <= LEVEL_ORDER[threshold];
  }

  private extractSource(entry: unknown): string | undefined {
    const data = (entry ?? {}) as Record<string, unknown>;
    return typeof data.source === 'string' ? data.source : undefined;
  }

  /**
   * Resolves the effective log level for a given source.
   * If a per-source override exists, it takes precedence over the global level.
   * Otherwise the global level is used.
   */
  private resolveEffectiveLevel(
    globalLevel: LogOutputLevel,
    sources: Record<string, LogOutputLevel> | undefined,
    source: string | undefined
  ): LogOutputLevel {
    if (source && sources?.[source] !== undefined) {
      return sources[source];
    }
    return globalLevel;
  }

  private inferEntryLevel(entry: unknown): LogLevel {
    const source = (entry ?? {}) as Record<string, unknown>;
    const explicit = this.normalizeLevel(source.level);
    if (explicit) return explicit;

    if (source.error) return 'error';

    const event = (source.event ?? {}) as Record<string, unknown>;
    const kindLevel = this.normalizeLevel(event.kind);
    if (kindLevel) return kindLevel;

    const phaseLevel = this.normalizeLevel(event.phase ?? source.phase);
    if (phaseLevel) return phaseLevel;

    if (source.source === 'stream-perf') return 'debug';

    // Runtime stream events (tool, question, handoff, started, etc.) are
    // diagnostic noise on the console. Classify as debug so they disappear
    // when console level is set to warning or error, but stay available for
    // file logging and API surfaces.
    if (source.source === 'runtime' || source.source === 'stream') {
      return 'debug';
    }

    return 'info';
  }

  private normalizeLevel(value: unknown): LogLevel | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'warn') return 'warning';
    if (normalized === 'error') return 'error';
    if (normalized === 'warning') return 'warning';
    if (normalized === 'info') return 'info';
    if (normalized === 'debug') return 'debug';
    return undefined;
  }

  private writeToConsole(entry: unknown): void {
    try {
      const data = (entry ?? {}) as Record<string, unknown>;
      if (data.source === 'llm') {
        this.writeLlmToConsole(data);
        return;
      }
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must never break runtime execution.
    }
  }

  private writeLlmToConsole(data: Record<string, unknown>): void {
    const isError = Boolean(data.error);
    const mode = (data.mode as string) ?? '?';
    const agentName =
      (data.agent as { name?: string })?.name ?? 'system';
    const model = (data.model as string) ?? '?';
    const durationMs = data.durationMs as number | undefined;
    const responseText =
      typeof (data.response as { text?: string })?.text === 'string'
        ? (data.response as { text: string }).text
        : '';
    const userMessage = this.extractLlmUserMessage(data);

    // Header line: HH:MM:SS [llm:mode] Agent → model done/error DURATIONms
    const time = new Date().toISOString().slice(11, 19);
    const modeColor = mode.startsWith('stream') ? C.cyan : C.reset;
    const statusColor = isError ? C.red : C.green;
    const statusLabel = isError ? 'error' : 'done';
    const durationLabel = durationMs === undefined ? '' : ` ${durationMs}ms`;

    const header = [
      `${C.gray}${time}${C.reset}`,
      `${C.dim}[llm:${mode}]${C.reset}`,
      `${C.bold}${agentName}${C.reset}`,
      `${modeColor}→ ${model}${C.reset}`,
      `${statusColor}${statusLabel}${C.reset}`,
      `${C.dim}${durationLabel}${C.reset}`,
    ].filter(Boolean).join(' ');

    const lines = [header];

    if (userMessage) {
      const preview = userMessage.slice(0, 120).replaceAll('\n', ' ');
      const ellipsis = userMessage.length > 120 ? '…' : '';
      lines.push(`  ${C.gray}user:${C.reset} ${C.white}${preview}${ellipsis}${C.reset}`);
    }

    if (responseText) {
      const preview = responseText.slice(0, 200).replaceAll('\n', ' ');
      const ellipsis = responseText.length > 200 ? '…' : '';
      lines.push(`  ${C.gray}reply:${C.reset} ${C.green}${preview}${ellipsis}${C.reset}`);
    }

    if (isError) {
      const errMsg =
        typeof (data.error as { message?: string })?.message === 'string'
          ? (data.error as { message: string }).message
          : JSON.stringify(data.error);
      lines.push(`  ${C.red}error: ${errMsg}${C.reset}`);
    }

    process.stderr.write(lines.join('\n') + '\n');
  }

  private extractLlmUserMessage(data: Record<string, unknown>): string {
    const messages = (data.request as { messages?: unknown[] })?.messages;
    if (!Array.isArray(messages)) return '';
    const lastUser = [...messages].reverse().find(
      (m: unknown) => (m as { role?: string })?.role === 'user'
    );
    if (!lastUser) return '';
    const content = (lastUser as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .map((c: unknown) => {
        const part = c as { type?: string; text?: string };
        return part.type === 'text' && typeof part.text === 'string' ? part.text : '';
      })
      .join('');
  }

  private resolveLogFilePath(): string {
    const configured = process.env.AI_TEAM_BACKEND_LOG_FILE;
    if (configured && configured.trim().length > 0) {
      return path.isAbsolute(configured)
        ? configured
        : path.resolve(this.workspaceRoot, configured);
    }

    return path.join(this.workspaceRoot, LOG_DIR, DEFAULT_LOG_FILE);
  }

  private cleanupOldLogs(): void {
    const settings = this.settingsService.resolveForRuntime(this.runtimeProfileResolver());
    // retentionHours takes precedence; fall back to retentionDays (default 7)
    const hours =
      settings.retentionHours ?? (settings.retentionDays ?? DEFAULT_RETENTION_DAYS) * 24;
    const logDir = path.join(this.workspaceRoot, LOG_DIR);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    fs.readdir(logDir)
      .then((files) => {
        const oldFiles = files.filter((f) => {
          if (!f.startsWith(LOG_PREFIX) || !f.endsWith('.log')) return false;
          const dateStr = f.slice(LOG_PREFIX.length, -4);
          const parsed = Date.parse(`${dateStr}T00:00:00Z`);
          return !Number.isNaN(parsed) && parsed < cutoff;
        });
        return Promise.all(
          oldFiles.map((f) => fs.unlink(path.join(logDir, f)).catch(() => {}))
        );
      })
      .catch(() => {
        // Cleanup failure is non-fatal
      });
  }
}
