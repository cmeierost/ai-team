import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  getAllAgents: vi.fn(),
  resolveAgent: vi.fn(),
  loadTeamConfig: vi.fn(),
  createPermissionEngine: vi.fn(),
}));

vi.mock('@ai-team/core', () => {
  class AgentManager {
    constructor(_workspaceRoot: string) {}
    initialize = coreApi.initialize;
    getAllAgents = coreApi.getAllAgents;
    resolveAgent = coreApi.resolveAgent;
  }

  return {
    AgentManager,
    loadTeamConfig: coreApi.loadTeamConfig,
    createPermissionEngine: coreApi.createPermissionEngine,
  };
});

import { doIHaveAccessCommand, whoHasAccessCommand } from './access.js';

describe('access command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreApi.initialize.mockResolvedValue(undefined);
    coreApi.loadTeamConfig.mockResolvedValue({ fileTree: { readPaths: [] } });
    coreApi.getAllAgents.mockReturnValue([
      { id: 'agent-a', name: 'Agent A', role: 'dev' },
      { id: 'agent-b', name: 'Agent B', role: 'dev' },
    ]);
    coreApi.resolveAgent.mockImplementation((query: string) => {
      if (query === 'agent-b') {
        return [{ id: 'agent-b', name: 'Agent B', role: 'dev' }];
      }
      return [];
    });

    coreApi.createPermissionEngine.mockReturnValue({
      whoCanAccess: vi.fn().mockReturnValue(['agent-a']),
      getContext: vi.fn().mockImplementation((id: string) => ({ id, label: id.toUpperCase() })),
      checkPath: vi.fn().mockReturnValue({
        allowed: true,
        explanation: 'allowed',
        paths: [],
        alternativeContexts: [],
      }),
      whatCanContextDo: vi.fn().mockReturnValue(new Map([['docs/readme.md', new Set(['list'])]])),
    });
  });

  it('whoHasAccessCommand defaults right to list', async () => {
    const result = await whoHasAccessCommand('c:/workspace', { path: 'docs/readme.md' });
    expect(result.right).toBe('list');
    expect(result.contextIds).toEqual(['agent-a']);
  });

  it('doIHaveAccessCommand resolves explicit agent override', async () => {
    const result = await doIHaveAccessCommand('c:/workspace', { path: 'docs/readme.md', agent: 'agent-b' });
    expect(result.contextId).toBe('agent-b');
    expect(result.selectedBy).toBe('explicit');
    expect(result.allowed).toBe(true);
  });
});
