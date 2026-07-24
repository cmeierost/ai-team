import path from 'node:path';
import fs from 'node:fs/promises';
import { ConfigurationStorage } from '@ai-team/infrastructure';
import type { LogDestinationLevel } from '@ai-team/core';

type CliLogLevel = Exclude<LogDestinationLevel, 'off'>;

const CLI_LOG_LEVEL_ORDER: Record<CliLogLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

interface CliLogSettings {
  file: LogDestinationLevel;
  console: LogDestinationLevel;
}

export class CliLogService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly configurationStorage: Pick<ConfigurationStorage, 'get'>,
    private readonly workspaceRootProvider: () => string = () => process.cwd()
  ) {}

  isFileLogEnabled(): boolean {
    return this.resolveSettings().file !== 'off';
  }

  write(entry: unknown): void {
    const settings = this.resolveSettings();
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
        // Logging must never break CLI execution.
      });
  }

  private isConsoleLogEnabled(): boolean {
    return this.resolveSettings().console !== 'off';
  }

  private resolveSettings(): CliLogSettings {
    try {
      return {
        file: this.normalizeOutputLevel(this.configurationStorage.get('log.cli.file'), 'error'),
        console: this.normalizeOutputLevel(this.configurationStorage.get('log.cli.console'), 'off'),
      };
    } catch {
      return { file: 'error', console: 'off' };
    }
  }

  private shouldWrite(entryLevel: CliLogLevel, threshold: LogDestinationLevel): boolean {
    if (threshold === 'off') {
      return false;
    }
    return CLI_LOG_LEVEL_ORDER[entryLevel] <= CLI_LOG_LEVEL_ORDER[threshold];
  }

  private inferEntryLevel(entry: unknown): CliLogLevel {
    const source = (entry ?? {}) as Record<string, unknown>;
    const explicit = this.normalizeLevel(source.level);
    if (explicit) return explicit;

    if (source.error) return 'error';

    const event = (source.event ?? {}) as Record<string, unknown>;
    const kindLevel = this.normalizeLevel(event.kind);
    if (kindLevel) return kindLevel;

    const phaseLevel = this.normalizeLevel(event.phase ?? source.phase);
    if (phaseLevel) return phaseLevel;

    return 'info';
  }

  private normalizeLevel(value: unknown): CliLogLevel | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'warn') return 'warning';
    if (normalized === 'error') return 'error';
    if (normalized === 'warning') return 'warning';
    if (normalized === 'info') return 'info';
    if (normalized === 'debug') return 'debug';
    return undefined;
  }

  private normalizeOutputLevel(
    value: unknown,
    fallback: LogDestinationLevel
  ): LogDestinationLevel {
    if (typeof value === 'boolean') {
      return value ? 'info' : 'off';
    }

    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (
      normalized === 'off' ||
      normalized === 'none' ||
      normalized === 'false' ||
      normalized === '0'
    ) {
      return 'off';
    }
    if (normalized === 'true' || normalized === '1' || normalized === 'on') {
      return 'info';
    }

    const asLevel = this.normalizeLevel(normalized);
    return asLevel ?? fallback;
  }

  private writeToConsole(entry: unknown): void {
    try {
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must never break CLI execution.
    }
  }

  private resolveLogFilePath(): string {
    const configured = process.env.AI_TEAM_CLI_LOG_FILE;
    if (configured && configured.trim().length > 0) {
      return path.isAbsolute(configured)
        ? configured
        : path.resolve(this.workspaceRootProvider(), configured);
    }

    return path.join(this.workspaceRootProvider(), '.ai-team', 'logs', 'cli.log');
  }
}

let defaultWorkspaceRoot: string | undefined;
let defaultCliLogService: CliLogService | undefined;

function getDefaultCliLogService(): CliLogService {
  const workspaceRoot = process.cwd();
  if (defaultCliLogService && defaultWorkspaceRoot === workspaceRoot) {
    return defaultCliLogService;
  }

  defaultWorkspaceRoot = workspaceRoot;
  defaultCliLogService = new CliLogService(
    new ConfigurationStorage(workspaceRoot),
    () => process.cwd()
  );
  return defaultCliLogService;
}

export function isCliFileLogEnabled(): boolean {
  return getDefaultCliLogService().isFileLogEnabled();
}

export function writeCliLog(entry: unknown): void {
  getDefaultCliLogService().write(entry);
}
