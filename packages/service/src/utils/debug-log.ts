import path from 'node:path';
import { createDebugLogWriter } from './debug-log-shared.js';

export interface DebugLogSettings {
  file: boolean;
  console: boolean;
}

export type BackendDebugLogSettingsResolver = (workspaceRoot: string) => DebugLogSettings;

const DEFAULT_DEBUG_LOG_SETTINGS: DebugLogSettings = {
  file: false,
  console: false,
};

let backendDebugLogSettingsResolver: BackendDebugLogSettingsResolver | undefined;

export function setBackendDebugLogSettingsResolver(
  resolver: BackendDebugLogSettingsResolver | undefined
): void {
  backendDebugLogSettingsResolver = resolver;
}

function resolveBackendDebugLogSettings(workspaceRoot: string): DebugLogSettings {
  if (!backendDebugLogSettingsResolver) {
    return DEFAULT_DEBUG_LOG_SETTINGS;
  }

  try {
    return backendDebugLogSettingsResolver(workspaceRoot);
  } catch {
    return DEFAULT_DEBUG_LOG_SETTINGS;
  }
}

function isBackendFileLogEnabled(workspaceRoot: string): boolean {
  return resolveBackendDebugLogSettings(workspaceRoot).file;
}

function isBackendConsoleLogEnabled(workspaceRoot: string): boolean {
  return resolveBackendDebugLogSettings(workspaceRoot).console;
}

function resolveBackendLogFile(workspaceRoot: string): string {
  const configured = process.env.AI_TEAM_BACKEND_LOG_FILE;
  if (configured && configured.trim().length > 0) {
    return path.isAbsolute(configured) ? configured : path.resolve(workspaceRoot, configured);
  }

  return path.join(workspaceRoot, '.ai-team', 'logs', 'backend.log');
}

const writeBackendDebugLogImpl = createDebugLogWriter<[string]>({
  isFileLogEnabled: isBackendFileLogEnabled,
  isConsoleLogEnabled: isBackendConsoleLogEnabled,
  resolveFilePath: resolveBackendLogFile,
});

export function writeBackendDebugLog(workspaceRoot: string, entry: unknown): void {
  writeBackendDebugLogImpl(entry, workspaceRoot);
}
