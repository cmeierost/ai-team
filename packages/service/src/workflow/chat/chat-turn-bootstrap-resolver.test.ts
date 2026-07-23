import { describe, expect, it, vi } from 'vitest';
import { ChatTurnBootstrapResolver } from './chat-turn-bootstrap-resolver.js';

const MICHAEL = { id: 'michael', name: 'Michael Brown' };
const EMILY = { id: 'emily', name: 'Emily Davis' };

function createResolver() {
  const sessions = new Map([
    ['session-michael', { id: 'session-michael', agentId: 'michael' }],
    ['session-emily', { id: 'session-emily', agentId: 'emily' }],
  ]);
  const agents = new Map([
    ['michael', MICHAEL],
    ['emily', EMILY],
  ]);
  const agentManager = {
    getAgentAsync: vi.fn(async (id: string) => agents.get(id)),
    resolveAgentForOperationAsync: vi.fn(async (id: string) => ({ id })),
  } as any;
  const sessionManager = {
    getSession: vi.fn(async (id: string) => sessions.get(id) ?? null),
    getSessionMessages: vi.fn(async (id: string) => [{ content: `history:${id}` }]),
    getLatestSession: vi.fn(async () => null),
    resolveLatestSessionForResume: vi.fn(async () => sessions.get('session-michael')),
    createSession: vi.fn(),
  } as any;
  const threadManager = {
    resolveActiveSession: vi.fn(async () => ({
      session: sessions.get('session-emily'),
      state: {
        rootSessionId: 'session-michael',
        activeSessionId: 'session-emily',
        navigationStack: [
          {
            agentId: 'michael',
            agentName: 'Michael Brown',
            sessionId: 'session-michael',
          },
        ],
        updatedAt: '2026-07-23T12:00:00.000Z',
      },
    })),
    resolveLatestActiveSession: vi.fn(async () => sessions.get('session-emily')),
  } as any;
  const developerIdentity = {
    getUserName: () => 'Clemens Meier',
    toDeveloperId: () => 'clemens-meier',
  } as any;

  return {
    resolver: new ChatTurnBootstrapResolver(
      agentManager,
      sessionManager,
      developerIdentity,
      threadManager
    ),
    threadManager,
  };
}

describe('ChatTurnBootstrapResolver thread resume', () => {
  it('resolves an explicit member session to the active session of its thread', async () => {
    const { resolver } = createResolver();
    const ctx: any = { history: [] };

    const result = await resolver.resolveAsync({ sessionId: 'session-michael' }, ctx);

    expect(result).toMatchObject({
      ok: true,
      agent: { id: 'emily' },
      sessionId: 'session-emily',
      history: [{ content: 'history:session-emily' }],
    });
    expect(ctx.navStack).toEqual([
      expect.objectContaining({ sessionId: 'session-michael' }),
    ]);
  });

  it('uses the persisted active cursor for bare chat resume', async () => {
    const { resolver, threadManager } = createResolver();

    const result = await resolver.resolveAsync({}, { history: [] });

    expect(threadManager.resolveLatestActiveSession).toHaveBeenCalledWith('clemens-meier');
    expect(result).toMatchObject({
      ok: true,
      agent: { id: 'emily' },
      sessionId: 'session-emily',
    });
  });
});
