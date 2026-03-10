import { describe, expect, it } from 'vitest';
import type { Agent, ChatSession } from '../types';
import { resolveSidebarChatPath } from './sidebarUtils';

const agents: Agent[] = [
  { id: 'daniel-navarro', name: 'Daniel Navarro', role: 'Frontend Lead' },
  { id: 'clara-bishop', name: 'Clara Bishop', role: 'Frontend Quality Engineer' },
];

describe('resolveSidebarChatPath', () => {
  it('returns the newest session route based on latest message activity', () => {
    const sessions: ChatSession[] = [
      {
        id: 'session-older',
        agentId: 'daniel-navarro',
        agentIds: ['daniel-navarro'],
        developerId: 'clemens-meier',
        startedAt: '2026-03-09T09:00:00.000Z',
        lastActivityAt: '2026-03-09T09:30:00.000Z',
        messageCount: 5,
        artifacts: [],
        allowedFiles: [],
      },
      {
        id: 'session-newest',
        agentId: 'clara-bishop',
        agentIds: ['clara-bishop'],
        developerId: 'clemens-meier',
        startedAt: '2026-03-09T10:00:00.000Z',
        lastActivityAt: '2026-03-09T10:45:00.000Z',
        messageCount: 8,
        artifacts: [],
        allowedFiles: [],
      },
    ];

    expect(resolveSidebarChatPath(sessions, agents)).toBe('/chat/clara-bishop/session/session-newest');
  });

  it('skips sessions for agents that are no longer present', () => {
    const sessions: ChatSession[] = [
      {
        id: 'session-retired',
        agentId: 'retired-agent',
        agentIds: ['retired-agent'],
        developerId: 'clemens-meier',
        startedAt: '2026-03-09T10:00:00.000Z',
        lastActivityAt: '2026-03-09T11:00:00.000Z',
        messageCount: 12,
        artifacts: [],
        allowedFiles: [],
      },
      {
        id: 'session-valid',
        agentId: 'daniel-navarro',
        agentIds: ['daniel-navarro'],
        developerId: 'clemens-meier',
        startedAt: '2026-03-09T09:00:00.000Z',
        lastActivityAt: '2026-03-09T10:30:00.000Z',
        messageCount: 4,
        artifacts: [],
        allowedFiles: [],
      },
    ];

    expect(resolveSidebarChatPath(sessions, agents)).toBe('/chat/daniel-navarro/session/session-valid');
  });

  it('falls back to the first available agent when there is no recent session yet', () => {
    expect(resolveSidebarChatPath([], agents)).toBe('/chat/daniel-navarro');
    expect(resolveSidebarChatPath([], [])).toBeNull();
  });
});