import { describe, expect, it, vi } from 'vitest';
import { accessCanCommand, accessOverlapCommand, accessWhoCommand } from './access.js';

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

  it('accessOverlapCommand calls the client overlap analyzer', async () => {
    const client = {
      analyzePermissionOverlap: vi.fn().mockResolvedValue({
        generatedAt: '2026-03-31T00:00:00.000Z',
        agentIds: ['alex-morgan', 'ethan-carter'],
        rights: {
          read: {
            right: 'read',
            totalDistinctAllowPatterns: 1,
            totalDistinctDenyPatterns: 0,
            sharedAllowPatterns: [{ pattern: 'packages/core/**/*', agentIds: ['alex-morgan', 'ethan-carter'], agentCount: 2 }],
            sharedDenyPatterns: [],
            agents: [],
            pairs: [],
          },
          list: { right: 'list', totalDistinctAllowPatterns: 0, totalDistinctDenyPatterns: 0, sharedAllowPatterns: [], sharedDenyPatterns: [], agents: [], pairs: [] },
          write: { right: 'write', totalDistinctAllowPatterns: 0, totalDistinctDenyPatterns: 0, sharedAllowPatterns: [], sharedDenyPatterns: [], agents: [], pairs: [] },
          create: { right: 'create', totalDistinctAllowPatterns: 0, totalDistinctDenyPatterns: 0, sharedAllowPatterns: [], sharedDenyPatterns: [], agents: [], pairs: [] },
          delete: { right: 'delete', totalDistinctAllowPatterns: 0, totalDistinctDenyPatterns: 0, sharedAllowPatterns: [], sharedDenyPatterns: [], agents: [], pairs: [] },
        },
      }),
    } as any;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await accessOverlapCommand(client, { right: 'read', agent: 'alex-morgan' });
      expect(client.analyzePermissionOverlap).toHaveBeenCalledTimes(1);
    } finally {
      logSpy.mockRestore();
    }
  });
});
