import { describe, expect, it, vi } from 'vitest';
import { accessCanCommand, accessWhoCommand } from './access.js';

describe('access cli commands', () => {
  it('accessWhoCommand uses list as default right', async () => {
    const client = {
      whoHasPermission: vi.fn().mockResolvedValue({
        path: { input: 'docs/readme.md', absolute: '/ws/docs/readme.md', relative: 'docs/readme.md' },
        right: 'list',
        contextIds: ['a'],
        contexts: [{ contextId: 'a', label: 'A' }],
        explanation: 'ok',
      }),
    } as any;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await accessWhoCommand(client, { path: 'docs/readme.md' });
      expect(client.whoHasPermission).toHaveBeenCalledWith({ path: 'docs/readme.md', right: 'list' });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('accessCanCommand passes optional agent override', async () => {
    const client = {
      doIHavePermission: vi.fn().mockResolvedValue({
        path: { input: 'docs/readme.md', absolute: '/ws/docs/readme.md', relative: 'docs/readme.md' },
        right: 'list',
        contextId: 'agent-b',
        selectedBy: 'explicit',
        allowed: true,
        allRights: ['list'],
        explanation: 'ok',
        alternativeContexts: [],
        deniedByIgnore: false,
        blockedByPatterns: [],
      }),
    } as any;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await accessCanCommand(client, { path: 'docs/readme.md', agent: 'agent-b' });
      expect(client.doIHavePermission).toHaveBeenCalledWith({
        path: 'docs/readme.md',
        right: 'list',
        agent: 'agent-b',
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});
