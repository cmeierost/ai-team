import fs from 'node:fs/promises';
import path from 'node:path';
import { ConfigurationStorage, findWorkspaceRoot } from '@ai-team/infrastructure';

let writeQueue: Promise<void> = Promise.resolve();
let configuredWorkspaceRoot: string | undefined;

export function configureRuntimeLogWorkspace(workspaceRoot: string): void {
  configuredWorkspaceRoot = workspaceRoot;
}

function resolveWorkspaceRoot(): string {
  return configuredWorkspaceRoot ?? findWorkspaceRoot();
}

export function writeServerError(
  error: unknown,
  context: Record<string, unknown> = {}
): void {
  const workspaceRoot = resolveWorkspaceRoot();
  const storage = new ConfigurationStorage(workspaceRoot);
  if (storage.get('log.server.file') === 'off') return;

  const normalized =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) };
  const payload = {
    timestamp: new Date().toISOString(),
    entry: {
      source: 'api-server',
      level: 'error',
      ...context,
      error: normalized,
    },
  };
  const filePath = path.join(workspaceRoot, '.ai-team', 'logs', 'server.log');

  writeQueue = writeQueue
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
    })
    .catch(() => {
      // Logging must not replace the original server failure.
    });
}

export function writeFrontendError(entry: Record<string, unknown>): void {
  const workspaceRoot = resolveWorkspaceRoot();
  const storage = new ConfigurationStorage(workspaceRoot);
  if (storage.get('log.frontend.file') === 'off') return;

  const filePath = path.join(workspaceRoot, '.ai-team', 'logs', 'frontend.log');
  const payload = {
    timestamp: new Date().toISOString(),
    entry: {
      source: 'web-frontend',
      level: 'error',
      ...entry,
    },
  };
  writeQueue = writeQueue
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
    })
    .catch(() => {
      // Browser telemetry must not affect request handling.
    });
}
