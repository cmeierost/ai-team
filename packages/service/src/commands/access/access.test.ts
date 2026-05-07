import { beforeEach, describe, expect, it, vi } from 'vitest';

const { agentManagerMock, pathPermissionCheckerMock } = vi.hoisted(() => {
  const agents = [
    {
      id: 'agent-a',
      name: 'Agent A',
      role: 'developer',
      permissions: { read: ['docs/**/*'], write: [] },
    },
    {
      id: 'agent-b',
      name: 'Agent B',
      role: 'developer',
      permissions: { read: ['src/**/*'], write: [] },
    },
  ];
  const agentManagerMock = {
    workspaceRoot: 'c:/workspace',
    getAllAgentsAsync: vi.fn().mockReturnValue(agents),
    resolveAgentForOperationAsync: vi.fn().mockImplementation(async (query: string) => {
      const match = agents.find((a) => a.id === query);
      if (!match) throw new Error(`No matching agent found for operation: ${query}`);
      return { id: match.id, name: match.name, role: match.role };
    }),
    getAgentAsync: vi
      .fn()
      .mockImplementation((id: string) => agents.find((a) => a.id === id) ?? null),
  };
  const pathPermissionCheckerMock = {
    canReadPath: vi.fn((_workspaceRoot: string, permissions: any, filePath: string) =>
      (permissions?.read ?? []).some((pattern: string) =>
        filePath.startsWith(pattern.replace('/**/*', '/'))
      )
    ),
    canWritePath: vi.fn((_workspaceRoot: string, permissions: any, filePath: string) =>
      (permissions?.write ?? []).some((pattern: string) =>
        filePath.startsWith(pattern.replace('/**/*', '/'))
      )
    ),
    canListPath: vi.fn((_workspaceRoot: string, permissions: any, filePath: string) =>
      (permissions?.read ?? []).some((pattern: string) =>
        filePath.startsWith(pattern.replace('/**/*', '/'))
      )
    ),
  };
  return { agentManagerMock, pathPermissionCheckerMock };
});

vi.mock('@ai-team/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ai-team/core')>();
  return {
    ...real,
    resolveWorkspacePathMeta: (workspaceRoot: string, inputPath: string) => {
      const absolute = inputPath.startsWith('/') || /^[A-Za-z]:/.test(inputPath)
        ? inputPath.replaceAll('\\', '/')
        : `${workspaceRoot}/${inputPath}`.replaceAll('\\', '/');
      const relative = absolute.startsWith(`${workspaceRoot}/`)
        ? absolute.slice(workspaceRoot.length + 1)
        : inputPath.replaceAll('\\', '/');
      const insideWorkspace = !relative.startsWith('..') && !/^[A-Za-z]:/.test(relative);

      return {
        insideWorkspace,
        absolute,
        relative,
      };
    },
    checkPathRight: (
      workspaceRoot: string,
      checker: typeof pathPermissionCheckerMock,
      permissions: any,
      relativePath: string,
      right: 'read' | 'write' | 'list'
    ) => {
      switch (right) {
        case 'read':
          return checker.canReadPath(workspaceRoot, permissions, relativePath);
        case 'write':
          return checker.canWritePath(workspaceRoot, permissions, relativePath);
        case 'list':
          return checker.canListPath(workspaceRoot, permissions, relativePath);
      }
    },
  };
});

import { AccessService } from './access-service.js';

describe('access command handlers', () => {
  let accessService: AccessService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults cleared by clearAllMocks
    agentManagerMock.getAllAgentsAsync.mockReturnValue([
      {
        id: 'agent-a',
        name: 'Agent A',
        role: 'developer',
        permissions: { read: ['docs/**/*'], write: [] },
      },
      {
        id: 'agent-b',
        name: 'Agent B',
        role: 'developer',
        permissions: { read: ['src/**/*'], write: [] },
      },
    ]);
    agentManagerMock.resolveAgentForOperationAsync.mockImplementation(async (query: string) => {
      const match = agentManagerMock
        .getAllAgentsAsync()
        .find((a: { id: string }) => a.id === query);
      if (!match) throw new Error(`No matching agent found for operation: ${query}`);
      return { id: match.id, name: match.name, role: match.role };
    });
    agentManagerMock.getAgentAsync.mockImplementation(
      (id: string) =>
        agentManagerMock.getAllAgentsAsync().find((a: { id: string }) => a.id === id) ?? null
    );
    accessService = new AccessService(agentManagerMock as any, pathPermissionCheckerMock as any);
  });

  it('whoHasAccess defaults right to list', async () => {
    const result = await accessService.whoHasAccess({
      path: 'docs/readme.md',
    });
    expect(result.right).toBe('list');
  });

  it('doIHaveAccess resolves explicit agent override', async () => {
    const result = await accessService.doIHaveAccess({
      path: 'src/app.ts',
      agent: 'agent-b',
    });
    expect(result.contextId).toBe('agent-b');
    expect(result.selectedBy).toBe('explicit');
  });
});
