import { describe, expect, it, vi } from 'vitest';
import { ChatStartupTargetResolver } from './chat-startup-target-resolver.js';

function createResolver() {
  const agents = new Map([
    ['michael', { id: 'michael', name: 'Michael Brown' }],
    ['emily', { id: 'emily', name: 'Emily Davis' }],
  ]);
  const agentManager = {
    resolveAgentForOperationAsync: vi.fn(async (query: string) => ({
      id: query === 'Emily Davis' ? 'emily' : query,
    })),
    getAgentAsync: vi.fn(async (id: string) => agents.get(id) ?? null),
    getAgentsByRoleAsync: vi.fn(async () => []),
  } as any;
  const threadManager = {
    resolveActiveSession: vi.fn(async () => ({
      session: { id: 'session-emily', agentId: 'emily' },
    })),
    resolveLatestActiveSession: vi.fn(async () => ({
      id: 'session-emily',
      agentId: 'emily',
    })),
  } as any;
  const developerIdentity = {
    getUserName: vi.fn(() => 'Clemens Meier'),
    toDeveloperId: vi.fn(() => 'clemens-meier'),
  } as any;

  return {
    resolver: new ChatStartupTargetResolver(agentManager, threadManager, developerIdentity),
    agentManager,
    threadManager,
  };
}

describe('ChatStartupTargetResolver', () => {
  it('resolves bare chat and explicit member-session resume to the same active target', async () => {
    const { resolver, threadManager } = createResolver();

    const bare = await resolver.resolve({});
    const explicit = await resolver.resolve({ sessionId: 'session-michael' });

    expect(bare).toMatchObject({
      agent: { id: 'emily' },
      sessionId: 'session-emily',
    });
    expect(explicit).toEqual(bare);
    expect(threadManager.resolveLatestActiveSession).toHaveBeenCalledWith('clemens-meier');
    expect(threadManager.resolveActiveSession).toHaveBeenCalledWith('session-michael');
  });

  it('treats an agent-only invocation as a new root target without thread traversal', async () => {
    const { resolver, threadManager } = createResolver();

    const target = await resolver.resolve({
      agentQuery: 'Emily Davis',
      createNewSession: true,
    });

    expect(target).toMatchObject({ agent: { id: 'emily' }, sessionId: undefined });
    expect(threadManager.resolveActiveSession).not.toHaveBeenCalled();
    expect(threadManager.resolveLatestActiveSession).not.toHaveBeenCalled();
  });

  it('falls back to the top-level CEO when no resumable session exists', async () => {
    const { resolver, threadManager, agentManager } = createResolver();
    threadManager.resolveLatestActiveSession.mockResolvedValueOnce(null);
    agentManager.getAgentsByRoleAsync.mockResolvedValueOnce([
      { id: 'michael', name: 'Michael Brown', role: 'ceo' },
    ]);

    const target = await resolver.resolve({});

    expect(target).toMatchObject({ agent: { id: 'michael' }, sessionId: undefined });
    expect(agentManager.getAgentsByRoleAsync).toHaveBeenCalledWith('ceo');
  });
});
