import { EventEmitter } from 'node:events';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessApi = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

const netApi = vi.hoisted(() => ({
  createConnection: vi.fn(),
}));

const workspaceApi = vi.hoisted(() => ({
  findWorkspaceRoot: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: childProcessApi.spawn,
}));

vi.mock('node:net', () => ({
  createConnection: netApi.createConnection,
}));

vi.mock('../utils/workspace.js', () => ({
  findWorkspaceRoot: workspaceApi.findWorkspaceRoot,
}));

import { runUiCommand } from './ui.js';

function createMockSocket(eventToEmit: 'connect' | 'error' | 'timeout' = 'error'): EventEmitter & {
  setTimeout: (timeout: number) => void;
  destroy: () => void;
} {
  const socket: EventEmitter & {
    setTimeout: (timeout: number) => void;
    destroy: () => void;
  } = new EventEmitter();

  socket.setTimeout = vi.fn();
  socket.destroy = vi.fn();

  queueMicrotask(() => {
    if (eventToEmit === 'error') {
      socket.emit('error', new Error('connection refused'));
      return;
    }

    socket.emit(eventToEmit);
  });

  return socket;
}

describe('runUiCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceApi.findWorkspaceRoot.mockImplementation((dir: string) => dir);
  });

  it('starts only web dev server when API is already running', async () => {
    netApi.createConnection.mockReturnValue(createMockSocket('connect'));
    childProcessApi.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('exit', 0, null);
      });
      return child;
    });

    await runUiCommand('c:/workspace-root', { workspace: 'nested/workspace' });

    expect(netApi.createConnection).toHaveBeenCalledWith({ port: 3002, host: '127.0.0.1' });

    expect(childProcessApi.spawn).toHaveBeenCalledTimes(1);
    const [command, args, spawnOptions] = childProcessApi.spawn.mock.calls[0] as [
      string,
      string[],
      { cwd: string; stdio: string },
    ];

    expect(command).toBe(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
    expect(args).toEqual(['--filter', '@ai-team/web', 'dev']);
    expect(spawnOptions.cwd).toBe(path.resolve('c:/workspace-root', 'nested/workspace'));
    expect(spawnOptions.stdio).toBe('inherit');
  });

  it('starts API and web when API is not running', async () => {
    netApi.createConnection.mockReturnValue(createMockSocket('error'));
    childProcessApi.spawn
      .mockImplementationOnce((_command: string, _args: string[]) => {
        const child = new EventEmitter();
        queueMicrotask(() => {
          child.emit('exit', 0, null);
        });
        return child;
      })
      .mockImplementationOnce((_command: string, _args: string[]) => {
        const child = new EventEmitter();
        queueMicrotask(() => {
          child.emit('exit', 0, null);
        });
        return child;
      });

    await runUiCommand('c:/workspace-root');

    expect(workspaceApi.findWorkspaceRoot).toHaveBeenCalledWith('c:/workspace-root');
    expect(childProcessApi.spawn).toHaveBeenCalledTimes(2);
    const [, apiArgs] = childProcessApi.spawn.mock.calls[0] as [string, string[]];
    const [, webArgs] = childProcessApi.spawn.mock.calls[1] as [string, string[]];
    expect(apiArgs).toEqual(['--filter', '@ai-team/api-server', 'dev']);
    expect(webArgs).toEqual(['--filter', '@ai-team/web', 'dev']);
  });

  it('starts API and web when includeApi is true even if API is already running', async () => {
    netApi.createConnection.mockReturnValue(createMockSocket('connect'));
    childProcessApi.spawn
      .mockImplementationOnce((_command: string, _args: string[]) => {
        const child = new EventEmitter();
        queueMicrotask(() => {
          child.emit('exit', 0, null);
        });
        return child;
      })
      .mockImplementationOnce((_command: string, _args: string[]) => {
        const child = new EventEmitter();
        queueMicrotask(() => {
          child.emit('exit', 0, null);
        });
        return child;
      });

    await runUiCommand('c:/workspace-root', { includeApi: true });

    expect(netApi.createConnection).not.toHaveBeenCalled();
    expect(childProcessApi.spawn).toHaveBeenCalledTimes(2);
    const [, apiArgs] = childProcessApi.spawn.mock.calls[0] as [string, string[]];
    const [, webArgs] = childProcessApi.spawn.mock.calls[1] as [string, string[]];
    expect(apiArgs).toEqual(['--filter', '@ai-team/api-server', 'dev']);
    expect(webArgs).toEqual(['--filter', '@ai-team/web', 'dev']);
  });

  it('starts only web with custom server url and injects env override', async () => {
    childProcessApi.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('exit', 0, null);
      });
      return child;
    });

    await runUiCommand('c:/workspace-root', { serverUrl: 'http://localhost:4111' });

    expect(netApi.createConnection).not.toHaveBeenCalled();
    const [, args, spawnOptions] = childProcessApi.spawn.mock.calls[0] as [
      string,
      string[],
      { cwd: string; stdio: string; env: Record<string, string | undefined> },
    ];
    expect(args).toEqual(['--filter', '@ai-team/web', 'dev']);
    expect(spawnOptions.env.VITE_AI_TEAM_API_BASE).toBe('http://localhost:4111');
  });

  it('throws validation error for invalid server url', async () => {
    await expect(
      runUiCommand('c:/workspace-root', { serverUrl: 'not-a-url' })
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    expect(childProcessApi.spawn).not.toHaveBeenCalled();
  });

  it('returns unavailable when process spawn fails', async () => {
    netApi.createConnection.mockReturnValue(createMockSocket('connect'));
    childProcessApi.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('error', new Error('spawn failed'));
      });
      return child;
    });

    await expect(runUiCommand('c:/workspace-root')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
});
