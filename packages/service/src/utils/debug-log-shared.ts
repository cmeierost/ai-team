import fs from 'node:fs/promises';
import path from 'node:path';

export function isFileLogEnabledFromEnv(envVarName: string): boolean {
  const value = process.env[envVarName]?.trim().toLowerCase();
  if (!value) {
    return true;
  }
  return value !== '0' && value !== 'false' && value !== 'off';
}

export function isConsoleLogEnabled(): boolean {
  const value = process.env.AI_TEAM_CONSOLE_LOG?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

function phaseColor(phase: string): string {
  switch (phase) {
    case 'error':
      return C.red;
    case 'warning':
      return C.yellow;
    case 'done':
    case 'complete':
    case 'success':
      return C.green;
    case 'thinking':
      return C.blue;
    case 'start':
    case 'init':
      return C.magenta;
    case 'working':
      return C.cyan;
    default:
      return C.white;
  }
}

export function formatDebugLogForConsole(entry: unknown): string {
  const e = (entry ?? {}) as Record<string, unknown>;
  const event = (e.event ?? {}) as Record<string, unknown>;
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  const kind = s(event.kind);
  const phase = s(event.phase) || kind;
  const source = s(e.source) || '?';
  const command = s(e.command) ? `:${s(e.command)}` : '';
  const message = s(event.message) || s(event.text);
  const time = new Date().toISOString().slice(11, 19);
  const phaseColorCode = 'error' in e ? C.red : phaseColor(phase);
  const tag = `${source}${command}`;

  const parts = [
    `${C.gray}${time}${C.reset}`,
    `${C.dim}[${tag}]${C.reset}`,
    phase ? `${phaseColorCode}${phase}${C.reset}` : '',
    message ? `${C.white}${message}${C.reset}` : '',
  ].filter(Boolean);

  return parts.join(' ');
}

function writeToConsole(entry: unknown): void {
  try {
    process.stderr.write(formatDebugLogForConsole(entry) + '\n');
  } catch {
    // Console logging must never break execution.
  }
}

export interface CreateDebugLogWriterOptions<TArgs extends unknown[]> {
  isFileLogEnabled: () => boolean;
  resolveFilePath: (...args: TArgs) => string;
}

export function createDebugLogWriter<TArgs extends unknown[]>(
  options: CreateDebugLogWriterOptions<TArgs>
): (entry: unknown, ...args: TArgs) => void {
  let writeQueue: Promise<void> = Promise.resolve();

  return (entry: unknown, ...args: TArgs): void => {
    if (isConsoleLogEnabled()) {
      writeToConsole(entry);
    }

    if (!options.isFileLogEnabled()) {
      return;
    }

    const filePath = options.resolveFilePath(...args);
    const payload = {
      timestamp: new Date().toISOString(),
      entry,
    };
    const line = `${JSON.stringify(payload)}\n`;

    writeQueue = writeQueue
      .then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, line, 'utf-8');
      })
      .catch(() => {
        // Debug logging must never break command execution.
      });
  };
}
