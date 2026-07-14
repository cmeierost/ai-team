import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { findWorkspaceRoot } from '@ai-team/infrastructure';
import { ServiceDomainError } from '@ai-team/service';

const DEFAULT_API_PORT = 3002;
const API_HOST = '127.0.0.1';

export interface UiCommandOptions {
  workspace?: string;
  serverUrl?: string;
  includeApi?: boolean;
}

function buildSafeEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }

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

function resolveWorkspace(workspaceRoot: string, workspaceOverride?: string): string {
  if (!workspaceOverride || workspaceOverride.trim().length === 0) {
    return findWorkspaceRoot(workspaceRoot);
  }

  return resolve(workspaceRoot, workspaceOverride);
}

function getPnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function normalizeServerUrl(serverUrl: string | undefined): string | undefined {
  if (!serverUrl || serverUrl.trim().length === 0) {
    return undefined;
  }

  try {
    return new URL(serverUrl).toString().replace(/\/$/, '');
  } catch {
    throw new ServiceDomainError('VALIDATION', `Invalid server URL '${serverUrl}'.`);
  }
}

function isInterruptedExit(code: number | null, signal: NodeJS.Signals | null): boolean {
  return signal === 'SIGINT' || signal === 'SIGTERM' || code === 130;
}

function spawnPnpmProcess(
  args: string[],
  resolvedWorkspace: string,
  envOverrides: Record<string, string>
): ChildProcess {
  return spawn(getPnpmCommand(), args, {
    cwd: resolvedWorkspace,
    stdio: 'inherit',
    env: buildSafeEnv(envOverrides),
    shell: process.platform === 'win32',
  });
}

async function runSingleProcess(
  args: string[],
  resolvedWorkspace: string,
  envOverrides: Record<string, string>
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawnPnpmProcess(args, resolvedWorkspace, envOverrides);

    child.once('error', (error) => {
      rejectPromise(
        new ServiceDomainError('UNAVAILABLE', `Failed to start UI process: ${error.message}`)
      );
    });

    child.once('exit', (code, signal) => {
      if (isInterruptedExit(code, signal) || code === 0) {
        resolvePromise();
        return;
      }

      const signalSuffix = signal ? ` (signal ${signal})` : '';
      rejectPromise(
        new ServiceDomainError(
          'INTERNAL',
          `UI process exited with code ${code ?? 'unknown'}${signalSuffix}.`
        )
      );
    });
  });
}

async function runParallelProcesses(
  resolvedWorkspace: string,
  envOverrides: Record<string, string>
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const apiChild = spawnPnpmProcess(
      ['--filter', '@ai-team/api-server', 'dev'],
      resolvedWorkspace,
      {}
    );
    const webChild = spawnPnpmProcess(
      ['--filter', '@ai-team/web', 'dev'],
      resolvedWorkspace,
      envOverrides
    );

    let settled = false;
    let exited = 0;

    const shutdownOther = (child: ChildProcess) => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };

    const resolveIfDone = () => {
      exited += 1;
      if (!settled && exited >= 2) {
        settled = true;
        resolvePromise();
      }
    };

    const fail = (message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      shutdownOther(apiChild);
      shutdownOther(webChild);
      rejectPromise(new ServiceDomainError('INTERNAL', message));
    };

    const handleError = (processName: 'API' | 'UI') => (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      shutdownOther(apiChild);
      shutdownOther(webChild);
      rejectPromise(
        new ServiceDomainError(
          'UNAVAILABLE',
          `Failed to start ${processName} process: ${error.message}`
        )
      );
    };

    const handleExit =
      (processName: 'API' | 'UI') => (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }

        if (isInterruptedExit(code, signal) || code === 0) {
          resolveIfDone();
          return;
        }

        const signalSuffix = signal ? ` (signal ${signal})` : '';
        fail(`${processName} process exited with code ${code ?? 'unknown'}${signalSuffix}.`);
      };

    apiChild.once('error', handleError('API'));
    webChild.once('error', handleError('UI'));

    apiChild.once('exit', handleExit('API'));
    webChild.once('exit', handleExit('UI'));
  });
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

export async function runUiCommand(
  workspaceRoot: string,
  options: UiCommandOptions = {}
): Promise<void> {
  const resolvedWorkspace = resolveWorkspace(workspaceRoot, options.workspace);
  const customServerUrl = normalizeServerUrl(options.serverUrl);
  const forceStartApi = options.includeApi === true;
  const apiAlreadyRunning = forceStartApi
    ? false
    : customServerUrl
      ? true
      : await isApiRunning(DEFAULT_API_PORT);

  const startApiAndWeb = !apiAlreadyRunning;

  const envOverrides: Record<string, string> = customServerUrl
    ? { VITE_AI_TEAM_API_BASE: customServerUrl }
    : {};

  if (startApiAndWeb) {
    await runParallelProcesses(resolvedWorkspace, envOverrides);
    return;
  }

  await runSingleProcess(['--filter', '@ai-team/web', 'dev'], resolvedWorkspace, envOverrides);
}
