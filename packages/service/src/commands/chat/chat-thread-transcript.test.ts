import { describe, expect, it, vi } from 'vitest';
import { ChatThreadTranscriptService } from './chat-thread-transcript.js';

describe('ChatThreadTranscriptService', () => {
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
});
