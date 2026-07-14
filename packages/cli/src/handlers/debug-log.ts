import path from 'node:path';
import fs from 'node:fs/promises';
import { ConfigurationStorage } from '@ai-team/infrastructure';
import type { LogDestinationLevel } from '@ai-team/core';

type FrontendLogLevel = Exclude<LogDestinationLevel, 'off'>;

const FRONTEND_LOG_LEVEL_ORDER: Record<FrontendLogLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

interface FrontendDebugLogSettings {
  file: LogDestinationLevel;
  console: LogDestinationLevel;
}

export class FrontendDebugLogService {
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

  private resolveSettings(): FrontendDebugLogSettings {
    try {
      return {
        file: this.normalizeOutputLevel(this.configurationStorage.get('log.frontend.file')),
        console: this.normalizeOutputLevel(this.configurationStorage.get('log.frontend.console')),
      };
    } catch {
      return { file: 'off', console: 'off' };
    }
  }

  private shouldWrite(entryLevel: FrontendLogLevel, threshold: LogDestinationLevel): boolean {
    if (threshold === 'off') {
      return false;
    }
    return FRONTEND_LOG_LEVEL_ORDER[entryLevel] <= FRONTEND_LOG_LEVEL_ORDER[threshold];
  }

  private inferEntryLevel(entry: unknown): FrontendLogLevel {
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

  private normalizeLevel(value: unknown): FrontendLogLevel | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'warn') return 'warning';
    if (normalized === 'error') return 'error';
    if (normalized === 'warning') return 'warning';
    if (normalized === 'info') return 'info';
    if (normalized === 'debug') return 'debug';
    return undefined;
  }

  private normalizeOutputLevel(value: unknown): LogDestinationLevel {
    if (typeof value === 'boolean') {
      return value ? 'info' : 'off';
    }

    if (typeof value !== 'string') {
      return 'off';
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
    return asLevel ?? 'off';
  }

  private writeToConsole(entry: unknown): void {
    try {
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must never break CLI execution.
    }
  }

  private resolveLogFilePath(): string {
    const configured = process.env.AI_TEAM_FRONTEND_LOG_FILE;
    if (configured && configured.trim().length > 0) {
      return path.isAbsolute(configured)
        ? configured
        : path.resolve(this.workspaceRootProvider(), configured);
    }

    return path.join(this.workspaceRootProvider(), '.ai-team', 'logs', 'frontend.log');
  }
}

let defaultWorkspaceRoot: string | undefined;
let defaultFrontendDebugLogService: FrontendDebugLogService | undefined;

function getDefaultFrontendDebugLogService(): FrontendDebugLogService {
  const workspaceRoot = process.cwd();
  if (defaultFrontendDebugLogService && defaultWorkspaceRoot === workspaceRoot) {
    return defaultFrontendDebugLogService;
  }

  defaultWorkspaceRoot = workspaceRoot;
  defaultFrontendDebugLogService = new FrontendDebugLogService(
    new ConfigurationStorage(workspaceRoot),
    () => process.cwd()
  );
  return defaultFrontendDebugLogService;
}

export function isFrontendFileLogEnabled(): boolean {
  return getDefaultFrontendDebugLogService().isFileLogEnabled();
}

export function writeFrontendDebugLog(entry: unknown): void {
  getDefaultFrontendDebugLogService().write(entry);
}
