import { describe, expect, it, vi } from 'vitest';
import { ChatThreadTranscriptService } from './chat-thread-transcript.js';

describe('ChatThreadTranscriptService', () => {
  function createService(
    sessions: any[],
    messages: Map<string, any[]>,
    agents = new Map<string, any>()
  ) {
    return new ChatThreadTranscriptService(
      { getSessionChain: vi.fn(async () => sessions) } as any,
      { getSessionMessages: vi.fn(async (id: string) => messages.get(id) ?? []) } as any,
      { getAgentAsync: vi.fn(async (id: string) => agents.get(id)) } as any
    );
  }

  it('loads the whole thread chronologically and deduplicates mirrored handoffs', async () => {
    const root = {
      id: 'session-michael',
      agentId: 'michael-brown',
      agentIds: ['michael-brown'],
    };
    const child = {
      id: 'session-emily',
      agentId: 'emily-davis',
      agentIds: ['emily-davis'],
      previousSessionId: root.id,
    };
    const briefing = {
      timestamp: '2026-07-23T10:02:00.000Z',
      from: 'michael-brown',
      to: 'emily-davis',
      isHuman: false,
      content: 'Please continue with the implementation.',
      handoffType: 'agent-briefing' as const,
      handoffId: 'handoff-1',
      handoffFromSessionId: root.id,
      handoffToSessionId: child.id,
    };
    const messages = new Map([
      [
        root.id,
        [
          {
            id: 1,
            timestamp: '2026-07-23T10:00:00.000Z',
            from: 'developer',
            isHuman: true,
            content: 'Can we repair this?',
          },
          {
            id: 2,
            timestamp: '2026-07-23T10:01:00.000Z',
            from: 'michael-brown',
            isHuman: false,
            content: 'I will hand this to Emily.',
          },
          briefing,
        ],
      ],
      [
        child.id,
        [
          briefing,
          {
            id: 4,
            timestamp: '2026-07-23T10:03:00.000Z',
            from: 'emily-davis',
            isHuman: false,
            content: 'I have the context.',
          },
        ],
      ],
    ]);
    const agents = new Map([
      ['michael-brown', { id: 'michael-brown', name: 'Michael Brown', role: 'CEO' }],
      ['emily-davis', { id: 'emily-davis', name: 'Emily Davis', role: 'Engineer' }],
    ]);
    const service = new ChatThreadTranscriptService(
      { getSessionChain: vi.fn(async () => [root, child]) } as any,
      { getSessionMessages: vi.fn(async (id: string) => messages.get(id) ?? []) } as any,
      { getAgentAsync: vi.fn(async (id: string) => agents.get(id)) } as any,
      {
        resolve: vi.fn((agent: any) => ({
          ...agent,
          resolvedLlm: {
            model: agent.id === 'michael-brown' ? 'gpt-5.2' : 'claude-sonnet',
          },
        })),
      } as any
    );

    const transcript = await service.load(child.id);

    expect(transcript.map((entry) => entry.kind)).toEqual([
      'message',
      'message',
      'handoff',
      'message',
    ]);
    expect(transcript.filter((entry) => entry.kind === 'handoff')).toHaveLength(1);
    expect(transcript[1]).toMatchObject({
      kind: 'message',
      agent: { name: 'Michael Brown', resolvedLlm: { model: 'gpt-5.2' } },
    });
    expect(transcript[3]).toMatchObject({
      kind: 'message',
      agent: { name: 'Emily Davis', resolvedLlm: { model: 'claude-sonnet' } },
    });
  });

  it('uses persisted message IDs to stabilize timestamp ties across session traversal order', async () => {
    const root = { id: 'root', agentId: 'michael', agentIds: ['michael'] };
    const child = { id: 'child', agentId: 'emily', agentIds: ['emily'], previousSessionId: 'root' };
    const messages = new Map([
      [
        root.id,
        [
          {
            id: 20,
            timestamp: '2026-07-23T10:00:00.000Z',
            from: 'michael',
            content: 'second',
          },
        ],
      ],
      [
        child.id,
        [
          {
            id: 10,
            timestamp: '2026-07-23T10:00:00.000Z',
            from: 'emily',
            content: 'first',
          },
        ],
      ],
    ]);

    const transcript = await createService([root, child], messages).load(child.id);

    expect(transcript.map((entry) => entry.message.content)).toEqual(['first', 'second']);
  });

  it('deduplicates legacy mirrored returns without a handoffId and keeps one return entry', async () => {
    const root = { id: 'root', agentId: 'michael', agentIds: ['michael'] };
    const child = { id: 'child', agentId: 'emily', agentIds: ['emily'], previousSessionId: 'root' };
    const legacyReturn = {
      timestamp: '2026-07-23T10:00:00.000Z',
      from: 'emily',
      to: 'michael',
      content: 'Returning with the decisions and next action.',
      handoffType: 'agent-briefing' as const,
      handoffFromSessionId: child.id,
      handoffToSessionId: root.id,
    };
    const messages = new Map([
      [root.id, [{ ...legacyReturn }]],
      [child.id, [{ ...legacyReturn }]],
    ]);

    const transcript = await createService([child, root], messages).load(child.id);

    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toMatchObject({
      kind: 'handoff',
      message: { from: 'emily', to: 'michael' },
    });
  });

  it('filters archived, hidden, low-importance, and internal control messages', async () => {
    const root = { id: 'root', agentId: 'michael', agentIds: ['michael'] };
    const timestamp = '2026-07-23T10:00:00.000Z';
    const messages = new Map([
      [
        root.id,
        [
          { id: 1, timestamp, from: 'michael', content: 'visible' },
          { id: 2, timestamp, from: 'michael', content: 'archived', archived: true },
          { id: 3, timestamp, from: 'michael', content: 'hidden', hiddenFromLlm: true },
          { id: 4, timestamp, from: 'michael', content: 'low', importance: 'low' },
          {
            id: 5,
            timestamp,
            from: 'developer',
            content:
              '[Handoff received] You have just been handed this conversation. Review the briefing above, acknowledge the context, and ask the developer how they would like to proceed.',
            isHuman: true,
          },
        ],
      ],
    ]);

    const transcript = await createService([root], messages).load(root.id);

    expect(transcript.map((entry) => entry.message.content)).toEqual(['visible']);
  });
});
