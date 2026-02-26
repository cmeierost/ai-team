import fs from 'node:fs/promises';
import path from 'node:path';

let writeQueue: Promise<void> = Promise.resolve();

export function isFrontendFileLogEnabled(): boolean {
  const value = process.env.AI_TEAM_FRONTEND_FILE_LOG?.trim().toLowerCase();
  if (!value) {
    return true;
  }
  return value !== '0' && value !== 'false' && value !== 'off';
}

function resolveFrontendLogFile(): string {
  const configured = process.env.AI_TEAM_FRONTEND_LOG_FILE;
  if (configured && configured.trim().length > 0) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  return path.join(process.cwd(), '.ai-team', 'logs', 'frontend.log');
}

export function writeFrontendDebugLog(entry: unknown): void {
  if (!isFrontendFileLogEnabled()) {
    return;
  }

  const filePath = resolveFrontendLogFile();
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
      // Debug logging must not affect CLI command flow.
    });
}
