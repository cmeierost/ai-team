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
    childProcessApi.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('exit', 0, null);
      });
      return child;
    });

    await runUiCommand('c:/workspace-root');

    expect(workspaceApi.findWorkspaceRoot).toHaveBeenCalledWith('c:/workspace-root');
    const [, args] = childProcessApi.spawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(['--filter', '@ai-team/api-server', '--filter', '@ai-team/web', '--parallel', 'dev']);
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
