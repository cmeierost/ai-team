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
    resolveLatestSessionWithActivity: vi.fn(async () => ({
      id: 'session-michael',
      agentId: 'michael',
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
  it('resolves bare chat to the session with the latest message or tool activity', async () => {
    const { resolver, threadManager } = createResolver();

    const bare = await resolver.resolve({});

    expect(bare).toMatchObject({
      agent: { id: 'michael' },
      sessionId: 'session-michael',
      createNewSession: false,
    });
    expect(threadManager.resolveLatestSessionWithActivity).toHaveBeenCalledWith('clemens-meier');
    expect(threadManager.resolveLatestActiveSession).not.toHaveBeenCalled();
  });

  it('resolves an explicit member session through its persisted thread cursor', async () => {
    const { resolver, threadManager } = createResolver();

    const explicit = await resolver.resolve({ sessionId: 'session-michael' });

    expect(explicit).toMatchObject({
      agent: { id: 'emily' },
      sessionId: 'session-emily',
      createNewSession: false,
    });
    expect(threadManager.resolveActiveSession).toHaveBeenCalledWith('session-michael');
  });

  it('treats an agent-only invocation as a new root target without thread traversal', async () => {
    const { resolver, threadManager } = createResolver();

    const target = await resolver.resolve({
      agentQuery: 'Emily Davis',
    });

    expect(target).toMatchObject({
      agent: { id: 'emily' },
      sessionId: undefined,
      createNewSession: true,
    });
    expect(threadManager.resolveActiveSession).not.toHaveBeenCalled();
    expect(threadManager.resolveLatestSessionWithActivity).not.toHaveBeenCalled();
    expect(threadManager.resolveLatestActiveSession).not.toHaveBeenCalled();
  });

  it('falls back to the top-level CEO when no resumable session exists', async () => {
    const { resolver, threadManager, agentManager } = createResolver();
    threadManager.resolveLatestSessionWithActivity.mockResolvedValueOnce(null);
    agentManager.getAgentsByRoleAsync.mockResolvedValueOnce([
      { id: 'michael', name: 'Michael Brown', role: 'ceo' },
    ]);

    const target = await resolver.resolve({});

    expect(target).toMatchObject({
      agent: { id: 'michael' },
      sessionId: undefined,
      createNewSession: true,
    });
    expect(agentManager.getAgentsByRoleAsync).toHaveBeenCalledWith('ceo');
  });
});
