import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ServiceDomainError } from '../../errors.js';
import { findWorkspaceRoot } from '../../utils/workspace.js';

export interface ServeApiOptions {
  port?: string | number;
  workspace?: string;
  ui?: boolean;
  uiServerUrl?: string;
}

function getAitCommand(): string {
  return process.platform === 'win32' ? 'ait.cmd' : 'ait';
}

function launchUiProcessInBackground(resolvedWorkspace: string, serverUrl: string): void {
  const isWindows = process.platform === 'win32';
  const uiChild = spawn(getAitCommand(), ['ui', '--server-url', serverUrl], {
    cwd: resolvedWorkspace,
    detached: true,
    stdio: 'ignore',
    env: buildSafeEnv({}),
    shell: isWindows,
    windowsHide: true,
  });

  uiChild.once('error', (error) => {
    console.warn(`Unable to launch UI via 'ait ui': ${error.message}`);
  });

  uiChild.unref();
}

function buildSafeEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
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

  for (const [key, value] of Object.entries(overrides)) {
    safeEnv[key] = value;
  }

  return safeEnv;
}

function normalizePort(port: string | number | undefined): number | undefined {
  if (port === undefined || port === null || port === '') {
    return undefined;
  }

  const parsed = typeof port === 'number' ? port : Number.parseInt(port, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ServiceDomainError(
      'VALIDATION',
      `Invalid port '${String(port)}'. Expected an integer between 1 and 65535.`
    );
  }

  return parsed;
}

function resolveWorkspace(workspaceRoot: string, workspaceOverride?: string): string {
  if (!workspaceOverride || workspaceOverride.trim().length === 0) {
    return findWorkspaceRoot(workspaceRoot);
  }

  return resolve(workspaceRoot, workspaceOverride);
}

function resolveApiServerEntry(workspaceRoot: string): string {
  const repositoryRoot = findWorkspaceRoot(workspaceRoot);
  const entry = resolve(repositoryRoot, 'packages', 'api-server', 'dist', 'index.js');

  if (!existsSync(entry)) {
    throw new ServiceDomainError(
      'UNAVAILABLE',
      `Built API server not found at ${entry}. Run 'pnpm --filter @ai-team/api-server build' first.`
    );
  }

  return entry;
}

export async function serveApiCommand(
  workspaceRoot: string,
  options: ServeApiOptions = {}
): Promise<void> {
  const port = normalizePort(options.port);
  const resolvedWorkspace = resolveWorkspace(workspaceRoot, options.workspace);
  const effectivePort = port ?? 3002;
  const uiServerUrl = options.uiServerUrl?.trim() || `http://127.0.0.1:${effectivePort}`;
  const apiServerEntry = resolveApiServerEntry(workspaceRoot);
  const command = process.execPath;
  const args = [apiServerEntry];

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: resolvedWorkspace,
      stdio: 'inherit',
      env: buildSafeEnv({
        NODE_ENV: 'production',
        AI_TEAM_WORKSPACE: resolvedWorkspace,
        PORT: String(effectivePort),
      }),
    });

    if (options.ui) {
      launchUiProcessInBackground(resolvedWorkspace, uiServerUrl);
    }

    child.once('error', (error) => {
      rejectPromise(
        new ServiceDomainError(
          'UNAVAILABLE',
          `Failed to start API server process: ${error.message}`
        )
      );
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
          `API server process exited with code ${code ?? 'unknown'}${signalSuffix}.`
        )
      );
    });
  });
}
