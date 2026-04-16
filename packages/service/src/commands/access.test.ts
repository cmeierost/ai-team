import { beforeEach, describe, expect, it, vi } from 'vitest';

const { agentManagerMock } = vi.hoisted(() => {
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
    getAllAgentsAsync: vi.fn().mockReturnValue(agents),
    resolveAgentAsync: vi
      .fn()
      .mockImplementation((query: string) => agents.filter((a) => a.id === query)),
    getAgentAsync: vi
      .fn()
      .mockImplementation((id: string) => agents.find((a) => a.id === id) ?? null),
  };
  return { agentManagerMock };
});

vi.mock('@ai-team/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ai-team/core')>();
  return { ...real };
});

import { doIHaveAccessCommand, whoHasAccessCommand } from './access.js';

describe('access command handlers', () => {
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
    agentManagerMock.resolveAgentAsync.mockImplementation((query: string) =>
      agentManagerMock.getAllAgentsAsync().filter((a: { id: string }) => a.id === query)
    );
    agentManagerMock.getAgentAsync.mockImplementation(
      (id: string) =>
        agentManagerMock.getAllAgentsAsync().find((a: { id: string }) => a.id === id) ?? null
    );
  });

  it('whoHasAccessCommand defaults right to list', async () => {
    const result = await whoHasAccessCommand('c:/workspace', agentManagerMock as any, {
      path: 'docs/readme.md',
    });
    expect(result.right).toBe('list');
  });

  it('doIHaveAccessCommand resolves explicit agent override', async () => {
    const result = await doIHaveAccessCommand('c:/workspace', agentManagerMock as any, {
      path: 'src/app.ts',
      agent: 'agent-b',
    });
    expect(result.contextId).toBe('agent-b');
    expect(result.selectedBy).toBe('explicit');
  });
});
