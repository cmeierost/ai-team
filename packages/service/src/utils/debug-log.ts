import path from 'node:path';
import { createDebugLogWriter, isFileLogEnabledFromEnv } from './debug-log-shared.js';

function isBackendFileLogEnabled(): boolean {
  return isFileLogEnabledFromEnv('AI_TEAM_BACKEND_FILE_LOG');
}

function resolveBackendLogFile(workspaceRoot: string): string {
  const configured = process.env.AI_TEAM_BACKEND_LOG_FILE;
  if (configured && configured.trim().length > 0) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(workspaceRoot, configured);
  }

  return path.join(workspaceRoot, '.ai-team', 'logs', 'backend.log');
}

const writeBackendDebugLogImpl = createDebugLogWriter<[string]>({
  isFileLogEnabled: isBackendFileLogEnabled,
  resolveFilePath: resolveBackendLogFile,
});

export function writeBackendDebugLog(workspaceRoot: string, entry: unknown): void {
  writeBackendDebugLogImpl(entry, workspaceRoot);
}
