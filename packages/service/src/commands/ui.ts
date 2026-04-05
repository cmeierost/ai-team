import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { ServiceDomainError } from '../errors.js';
import { findWorkspaceRoot } from '../utils/workspace.js';

const DEFAULT_API_PORT = 3002;
const API_HOST = '127.0.0.1';

export interface UiCommandOptions {
  workspace?: string;
}

function buildSafeEnv(): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }

    // Windows process environments can contain pseudo variables like '=C:'
    // that are invalid when passed to child_process.spawn and can trigger EINVAL.
    if (key.startsWith('=') || key.includes('=')) {
      continue;
    }

    safeEnv[key] = value;
  }

  return safeEnv;
}

function resolveWorkspace(workspaceRoot: string, workspaceOverride?: string): string {
  if (!workspaceOverride || workspaceOverride.trim().length === 0) {
    return findWorkspaceRoot(workspaceRoot);
  }

  return resolve(workspaceRoot, workspaceOverride);
}

function getPnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

async function isApiRunning(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolvePromise) => {
    const socket = createConnection({ port, host: API_HOST });
    let resolved = false;

    const finalize = (isRunning: boolean) => {
      if (resolved) {
        return;
      }

      resolved = true;
      socket.destroy();
      resolvePromise(isRunning);
    };

    socket.setTimeout(400);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false));
    socket.once('error', () => finalize(false));
  });
}

export async function runUiCommand(workspaceRoot: string, options: UiCommandOptions = {}): Promise<void> {
  const resolvedWorkspace = resolveWorkspace(workspaceRoot, options.workspace);
  const apiAlreadyRunning = await isApiRunning(DEFAULT_API_PORT);

  const args = apiAlreadyRunning
    ? ['--filter', '@ai-team/web', 'dev']
    : ['--filter', '@ai-team/api-server', '--filter', '@ai-team/web', '--parallel', 'dev'];

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(getPnpmCommand(), args, {
      cwd: resolvedWorkspace,
      stdio: 'inherit',
      env: buildSafeEnv(),
    });

    child.once('error', (error) => {
      rejectPromise(new ServiceDomainError('UNAVAILABLE', `Failed to start UI process: ${error.message}`));
    });

    child.once('exit', (code, signal) => {
      const interrupted = signal === 'SIGINT' || signal === 'SIGTERM' || code === 130;
      if (interrupted || code === 0) {
        resolvePromise();
        return;
      }

      const signalSuffix = signal ? ` (signal ${signal})` : '';
      rejectPromise(
        new ServiceDomainError(
          'INTERNAL',
          `UI process exited with code ${code ?? 'unknown'}${signalSuffix}.`,
        ),
      );
    });
  });
}
