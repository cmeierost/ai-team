import path from 'node:path';
import { ConfigurationStorage } from '@ai-team/infrastructure';
import { createDebugLogWriter } from '@ai-team/service';

const configStorageByWorkspaceRoot = new Map<string, ConfigurationStorage>();

function getConfigurationStorage(workspaceRoot: string): ConfigurationStorage {
  const cached = configStorageByWorkspaceRoot.get(workspaceRoot);
  if (cached) {
    return cached;
  }

  const created = new ConfigurationStorage(workspaceRoot);
  configStorageByWorkspaceRoot.set(workspaceRoot, created);
  return created;
}

function resolveFrontendDebugLogSettings(workspaceRoot: string): { file: boolean; console: boolean } {
  try {
    const storage = getConfigurationStorage(workspaceRoot);
    return {
      file: Boolean(storage.get('log.file')),
      console: Boolean(storage.get('log.console')),
    };
  } catch {
    return { file: false, console: false };
  }
}

export function isFrontendFileLogEnabled(): boolean {
  const workspaceRoot = process.cwd();
  return resolveFrontendDebugLogSettings(workspaceRoot).file;
}

function isFrontendConsoleLogEnabled(): boolean {
  const workspaceRoot = process.cwd();
  return resolveFrontendDebugLogSettings(workspaceRoot).console;
}

function resolveFrontendLogFile(): string {
  const configured = process.env.AI_TEAM_FRONTEND_LOG_FILE;
  if (configured && configured.trim().length > 0) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  return path.join(process.cwd(), '.ai-team', 'logs', 'frontend.log');
}

const writeFrontendDebugLogImpl = createDebugLogWriter<[]>({
  isFileLogEnabled: () => isFrontendFileLogEnabled(),
  isConsoleLogEnabled: () => isFrontendConsoleLogEnabled(),
  resolveFilePath: resolveFrontendLogFile,
});

export function writeFrontendDebugLog(entry: unknown): void {
  writeFrontendDebugLogImpl(entry);
}
