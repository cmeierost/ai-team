import { describe, expect, it, vi } from 'vitest';
import { renderAccessCan, renderAccessOverlap, renderAccessWho } from './access.js';

describe('access cli commands', () => {
  it('renderAccessWho prints candidate contexts', async () => {
    const response = {
      path: { input: 'docs/readme.md', absolute: '/ws/docs/readme.md', relative: 'docs/readme.md' },
      right: 'list',
      contextIds: ['a'],
      contexts: [{ contextId: 'a', label: 'A' }],
      explanation: 'ok',
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      renderAccessWho(response);
      expect(logSpy).toHaveBeenCalled();
      expect(logSpy.mock.calls.flat().join(' ')).toContain('docs/readme.md');
      expect(logSpy.mock.calls.flat().join(' ')).toContain('A');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('renderAccessCan prints allowed result', async () => {
    const response = {
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
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      renderAccessCan(response);
      expect(logSpy.mock.calls.flat().join(' ')).toContain('ALLOWED');
      expect(logSpy.mock.calls.flat().join(' ')).toContain('agent-b');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('renderAccessOverlap prints overlap summary', async () => {
    const report = {
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
          overlappingFiles: [
            {
              path: 'packages/core/src/index.ts',
              extension: '.ts',
              lineCount: 20,
              agentIds: ['alex-morgan', 'ethan-carter'],
            },
          ],
          agentResponsibilities: [],
          pairs: [],
        },
        list: {
          right: 'list',
          totalFiles: 2,
          uncoveredFiles: [],
          singlyOwnedFiles: [],
          overlappingFiles: [],
          agentResponsibilities: [],
          pairs: [],
        },
        write: {
          right: 'write',
          totalFiles: 2,
          uncoveredFiles: [],
          singlyOwnedFiles: [],
          overlappingFiles: [],
          agentResponsibilities: [],
          pairs: [],
        },
        create: {
          right: 'create',
          totalFiles: 2,
          uncoveredFiles: [],
          singlyOwnedFiles: [],
          overlappingFiles: [],
          agentResponsibilities: [],
          pairs: [],
        },
        delete: {
          right: 'delete',
          totalFiles: 2,
          uncoveredFiles: [],
          singlyOwnedFiles: [],
          overlappingFiles: [],
          agentResponsibilities: [],
          pairs: [],
        },
      },
      outsideDefaultContextByAgent: [],
      agentFocus: {
        agentId: 'alex-morgan',
        rights: {
          read: {
            right: 'read',
            responsibility: {
              agentId: 'alex-morgan',
              fileCount: 1,
              lineCount: 20,
              byExtension: [{ extension: '.ts', fileCount: 1, lineCount: 20 }],
            },
            overlapsWith: [],
            uniqueFiles: [],
            globallyUncoveredFiles: [],
          },
          list: {
            right: 'list',
            responsibility: { agentId: 'alex-morgan', fileCount: 0, lineCount: 0, byExtension: [] },
            overlapsWith: [],
            uniqueFiles: [],
            globallyUncoveredFiles: [],
          },
          write: {
            right: 'write',
            responsibility: { agentId: 'alex-morgan', fileCount: 0, lineCount: 0, byExtension: [] },
            overlapsWith: [],
            uniqueFiles: [],
            globallyUncoveredFiles: [],
          },
          create: {
            right: 'create',
            responsibility: { agentId: 'alex-morgan', fileCount: 0, lineCount: 0, byExtension: [] },
            overlapsWith: [],
            uniqueFiles: [],
            globallyUncoveredFiles: [],
          },
          delete: {
            right: 'delete',
            responsibility: { agentId: 'alex-morgan', fileCount: 0, lineCount: 0, byExtension: [] },
            overlapsWith: [],
            uniqueFiles: [],
            globallyUncoveredFiles: [],
          },
        },
      },
    } as any;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      renderAccessOverlap(report, { right: 'read', agent: 'alex-morgan' });
      expect(logSpy.mock.calls.flat().join(' ')).toContain('Workspace permission overlap');
      expect(logSpy.mock.calls.flat().join(' ')).toContain('alex-morgan');
    } finally {
      logSpy.mockRestore();
    }
  });
});
