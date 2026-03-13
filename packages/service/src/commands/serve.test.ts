import { EventEmitter } from 'node:events';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessApi = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

const workspaceApi = vi.hoisted(() => ({
  findWorkspaceRoot: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: childProcessApi.spawn,
}));

vi.mock('../utils/workspace.js', () => ({
  findWorkspaceRoot: workspaceApi.findWorkspaceRoot,
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

import { serveApiCommand } from './serve.js';
import { existsSync } from 'node:fs';

const fsApi = {
  existsSync: vi.mocked(existsSync),
};

describe('serveApiCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceApi.findWorkspaceRoot.mockImplementation((dir: string) => dir);
    fsApi.existsSync.mockReturnValue(true);
  });

  it('spawns built api-server process with production static-serving env', async () => {
    childProcessApi.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('exit', 0, null);
      });
      return child;
    });

    await serveApiCommand('c:/workspace-root', { port: '4012', workspace: 'nested/workspace' });

    expect(childProcessApi.spawn).toHaveBeenCalledTimes(1);
    const [command, args, spawnOptions] = childProcessApi.spawn.mock.calls[0] as [
      string,
      string[],
      { cwd: string; stdio: string; env: Record<string, string | undefined> },
    ];

    expect(command).toBe(process.execPath);
    expect(args[0]).toMatch(/packages[\\/]api-server[\\/]dist[\\/]index\.js$/);
    expect(spawnOptions.cwd).toBe(path.resolve('c:/workspace-root', 'nested/workspace'));
    expect(spawnOptions.stdio).toBe('inherit');
    expect(spawnOptions.env.NODE_ENV).toBe('production');
    expect(spawnOptions.env.PORT).toBe('4012');
    expect(spawnOptions.env.AI_TEAM_WORKSPACE).toBe(path.resolve('c:/workspace-root', 'nested/workspace'));
  });

  it('uses resolved workspace root and default port when options are omitted', async () => {
    workspaceApi.findWorkspaceRoot.mockReturnValue('c:/resolved-workspace');
    childProcessApi.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('exit', 0, null);
      });
      return child;
    });

    await serveApiCommand('c:/workspace-root');

    expect(workspaceApi.findWorkspaceRoot).toHaveBeenCalledWith('c:/workspace-root');
    const [, , spawnOptions] = childProcessApi.spawn.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: Record<string, string | undefined> },
    ];

    expect(spawnOptions.cwd).toBe('c:/resolved-workspace');
    expect(spawnOptions.env.AI_TEAM_WORKSPACE).toBe('c:/resolved-workspace');
    expect(spawnOptions.env.PORT).toBe('3002');
  });

  it('treats SIGINT shutdown as normal completion', async () => {
    childProcessApi.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('exit', null, 'SIGINT');
      });
      return child;
    });

    await expect(serveApiCommand('c:/workspace-root')).resolves.toBeUndefined();
  });

  it('rejects invalid ports before spawning', async () => {
    await expect(serveApiCommand('c:/workspace-root', { port: '0' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    expect(childProcessApi.spawn).not.toHaveBeenCalled();
  });

  it('returns unavailable when process spawn fails', async () => {
    childProcessApi.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('error', new Error('spawn failed'));
      });
      return child;
    });

    await expect(serveApiCommand('c:/workspace-root')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('returns unavailable when built api-server entry is missing', async () => {
    fsApi.existsSync.mockReturnValue(false);

    await expect(serveApiCommand('c:/workspace-root')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });

    expect(childProcessApi.spawn).not.toHaveBeenCalled();
  });

  it('filters invalid env keys that can cause spawn EINVAL on Windows', async () => {
    const originalInvalidKey = (process.env as Record<string, string | undefined>)['=C:'];
    (process.env as Record<string, string | undefined>)['=C:'] = String.raw`C:\workspace-root`;

    childProcessApi.spawn.mockImplementation((_command: string, _args: string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        child.emit('exit', 0, null);
      });
      return child;
    });

    try {
      await serveApiCommand('c:/workspace-root');

      const [, , spawnOptions] = childProcessApi.spawn.mock.calls[0] as [
        string,
        string[],
        { env: Record<string, string | undefined> },
      ];

      expect(spawnOptions.env['=C:']).toBeUndefined();
    } finally {
      if (originalInvalidKey === undefined) {
        delete (process.env as Record<string, string | undefined>)['=C:'];
      } else {
        (process.env as Record<string, string | undefined>)['=C:'] = originalInvalidKey;
      }
    }
  });
});