import fs from 'node:fs/promises';
import path from 'node:path';

let writeQueue: Promise<void> = Promise.resolve();

function isBackendFileLogEnabled(): boolean {
  const value = process.env.AI_TEAM_BACKEND_FILE_LOG?.trim().toLowerCase();
  if (!value) {
    return true;
  }
  return value !== '0' && value !== 'false' && value !== 'off';
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

export function writeBackendDebugLog(workspaceRoot: string, entry: unknown): void {
  if (!isBackendFileLogEnabled()) {
    return;
  }

  const filePath = resolveBackendLogFile(workspaceRoot);
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
}
