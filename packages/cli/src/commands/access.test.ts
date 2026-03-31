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
        kind: 'files',
        generatedAt: '2026-03-31T00:00:00.000Z',
        agentIds: ['alex-morgan', 'ethan-carter'],
        workspaceFileCount: 2,
        rights: {
          read: {
            right: 'read',
            totalFiles: 2,
            uncoveredFiles: [],
            singlyOwnedFiles: [],
            overlappingFiles: [{ path: 'packages/core/src/index.ts', extension: '.ts', lineCount: 20, agentIds: ['alex-morgan', 'ethan-carter'] }],
            agentResponsibilities: [],
            pairs: [],
          },
          list: { right: 'list', totalFiles: 2, uncoveredFiles: [], singlyOwnedFiles: [], overlappingFiles: [], agentResponsibilities: [], pairs: [] },
          write: { right: 'write', totalFiles: 2, uncoveredFiles: [], singlyOwnedFiles: [], overlappingFiles: [], agentResponsibilities: [], pairs: [] },
          create: { right: 'create', totalFiles: 2, uncoveredFiles: [], singlyOwnedFiles: [], overlappingFiles: [], agentResponsibilities: [], pairs: [] },
          delete: { right: 'delete', totalFiles: 2, uncoveredFiles: [], singlyOwnedFiles: [], overlappingFiles: [], agentResponsibilities: [], pairs: [] },
        },
        agentFocus: {
          agentId: 'alex-morgan',
          rights: {
            read: {
              right: 'read',
              responsibility: { agentId: 'alex-morgan', fileCount: 1, lineCount: 20, byExtension: [{ extension: '.ts', fileCount: 1, lineCount: 20 }] },
              overlapsWith: [],
              uniqueFiles: [],
              globallyUncoveredFiles: [],
            },
            list: { right: 'list', responsibility: { agentId: 'alex-morgan', fileCount: 0, lineCount: 0, byExtension: [] }, overlapsWith: [], uniqueFiles: [], globallyUncoveredFiles: [] },
            write: { right: 'write', responsibility: { agentId: 'alex-morgan', fileCount: 0, lineCount: 0, byExtension: [] }, overlapsWith: [], uniqueFiles: [], globallyUncoveredFiles: [] },
            create: { right: 'create', responsibility: { agentId: 'alex-morgan', fileCount: 0, lineCount: 0, byExtension: [] }, overlapsWith: [], uniqueFiles: [], globallyUncoveredFiles: [] },
            delete: { right: 'delete', responsibility: { agentId: 'alex-morgan', fileCount: 0, lineCount: 0, byExtension: [] }, overlapsWith: [], uniqueFiles: [], globallyUncoveredFiles: [] },
          },
        },
      }),
    } as any;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await accessOverlapCommand(client, { right: 'read', agent: 'alex-morgan' });
      expect(client.analyzePermissionOverlap).toHaveBeenCalledWith({
        mode: 'files',
        agentId: 'alex-morgan',
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});
