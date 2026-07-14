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

export class InfrastructureBackendLogService implements IBackendLogService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspaceRoot: string,
    private readonly settingsService: IBackendDebugLogSettingsService,
    private readonly runtimeProfileResolver: () => BackendLogRuntimeProfile =
      InfrastructureBackendLogService.resolveRuntimeProfile
  ) {}

  write(entry: unknown): void {
    const settings = this.settingsService.resolveForRuntime(this.runtimeProfileResolver());
    const entryLevel = this.inferEntryLevel(entry);

    if (this.shouldWrite(entryLevel, settings.console)) {
      this.writeToConsole(entry);
    }

    if (!this.shouldWrite(entryLevel, settings.file)) {
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
      })
      .catch(() => {
        // Logging must never break runtime execution.
      });
  }

  private static resolveRuntimeProfile(): BackendLogRuntimeProfile {
    return process.env.AI_TEAM_RUNTIME_TARGET === 'api' ? 'api' : 'console';
  }

  private shouldWrite(entryLevel: LogLevel, threshold: LogOutputLevel): boolean {
    if (threshold === 'off') {
      return false;
    }
    return LEVEL_ORDER[entryLevel] <= LEVEL_ORDER[threshold];
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
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must never break runtime execution.
    }
  }

  private resolveLogFilePath(): string {
    const configured = process.env.AI_TEAM_BACKEND_LOG_FILE;
    if (configured && configured.trim().length > 0) {
      return path.isAbsolute(configured)
        ? configured
        : path.resolve(this.workspaceRoot, configured);
    }

    return path.join(this.workspaceRoot, '.ai-team', 'logs', 'backend.log');
  }
}
