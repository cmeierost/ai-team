import path from 'node:path';
import {
  createDebugLogWriter,
  isFileLogEnabledFromEnv,
} from '@ai-team/service/src/utils/debug-log-shared.js';

export function isFrontendFileLogEnabled(): boolean {
  return isFileLogEnabledFromEnv('AI_TEAM_FRONTEND_FILE_LOG');
}

function resolveFrontendLogFile(): string {
  const configured = process.env.AI_TEAM_FRONTEND_LOG_FILE;
  if (configured && configured.trim().length > 0) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  return path.join(process.cwd(), '.ai-team', 'logs', 'frontend.log');
}

const writeFrontendDebugLogImpl = createDebugLogWriter<[]>({
  isFileLogEnabled: isFrontendFileLogEnabled,
  resolveFilePath: resolveFrontendLogFile,
});

export function writeFrontendDebugLog(entry: unknown): void {
  writeFrontendDebugLogImpl(entry);
}
