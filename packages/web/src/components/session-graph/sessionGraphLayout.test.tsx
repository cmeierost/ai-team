import { describe, expect, it, vi } from 'vitest';
import type { Agent, SessionThread } from '../../types';
import { buildSessionGraphLayout, LABEL_W } from './sessionGraphLayout';

const agents = new Map<string, Agent>([
  ['sarah-lee', { id: 'sarah-lee', name: 'Sarah Lee', role: 'Chief Architect' }],
  ['daniel-navarro', { id: 'daniel-navarro', name: 'Daniel Navarro', role: 'Frontend Lead' }],
  ['clara-bishop', { id: 'clara-bishop', name: 'Clara Bishop', role: 'Frontend Quality Engineer' }],
]);

const thread: SessionThread = {
  rootSessionId: 'session-1',
  currentSessionId: 'session-3',
  depth: 2,
  sessions: [
    {
      sessionId: 'session-1',
      agentIds: ['sarah-lee'],
      agentNames: ['Sarah Lee'],
      developerId: 'dev',
      title: 'Architecture kickoff',
      startedAt: '2026-03-09T09:00:00.000Z',
      lastActivityAt: '2026-03-09T09:20:00.000Z',
      previousSessionId: null,
      mergedFromSessionIds: null,
      messageCount: 12,
      messages: [],
    },
    {
      sessionId: 'session-2',
      agentIds: ['daniel-navarro'],
      agentNames: ['Daniel Navarro'],
      developerId: 'dev',
      title: 'Frontend follow-up',
      startedAt: '2026-03-09T09:25:00.000Z',
      lastActivityAt: '2026-03-09T09:50:00.000Z',
      previousSessionId: 'session-1',
      mergedFromSessionIds: null,
      messageCount: 24,
      messages: [],
    },
    {
      sessionId: 'session-3',
      agentIds: ['clara-bishop'],
      agentNames: ['Clara Bishop'],
      developerId: 'dev',
      title: 'QA follow-up',
      startedAt: '2026-03-09T10:00:00.000Z',
      lastActivityAt: '2026-03-09T10:10:00.000Z',
      previousSessionId: 'session-2',
      mergedFromSessionIds: null,
      messageCount: 6,
      messages: [],
    },
  ],
  handoffs: [
    {
      handoffId: 'handoff-1',
      fromSessionId: 'session-1',
      toSessionId: 'session-2',
      fromAgentIds: ['sarah-lee'],
      toAgentIds: ['daniel-navarro'],
    },
    {
      handoffId: 'handoff-2',
      fromSessionId: 'session-2',
      toSessionId: 'session-3',
      fromAgentIds: ['daniel-navarro'],
      toAgentIds: ['clara-bishop'],
    },
  ],
};

describe('buildSessionGraphLayout', () => {
  it('creates lane, label, tick, bar, and handoff edge nodes for a thread', () => {
    const result = buildSessionGraphLayout(thread, 'session-3', agents, vi.fn());

    expect(result.nodes.some((node) => node.id === 'lane-sarah-lee')).toBe(true);
    expect(result.nodes.some((node) => node.id === 'label-daniel-navarro')).toBe(true);
    expect(result.nodes.some((node) => node.id === 'tick-session-1')).toBe(true);
    expect(result.nodes.some((node) => node.id === 'session-3')).toBe(true);
    expect(result.edges).toHaveLength(2);
  });

  it('places session bars in topological handoff order along the horizontal axis', () => {
    const result = buildSessionGraphLayout(thread, 'session-3', agents, vi.fn());

    const session1 = result.nodes.find((node) => node.id === 'session-1');
    const session2 = result.nodes.find((node) => node.id === 'session-2');
    const session3 = result.nodes.find((node) => node.id === 'session-3');

    expect(session1).toBeDefined();
    expect(session2).toBeDefined();
    expect(session3).toBeDefined();
    expect(session1!.position.x).toBeGreaterThan(LABEL_W);
    expect(session1!.position.x).toBeLessThan(session2!.position.x);
    expect(session2!.position.x).toBeLessThan(session3!.position.x);
  });

  it('marks the active session bar in its node data', () => {
    const result = buildSessionGraphLayout(thread, 'session-3', agents, vi.fn());

    const currentNode = result.nodes.find((node) => node.id === 'session-3');
    const earlierNode = result.nodes.find((node) => node.id === 'session-1');

    expect((currentNode?.data as { isCurrent?: boolean }).isCurrent).toBe(true);
    expect((earlierNode?.data as { isCurrent?: boolean }).isCurrent).toBe(false);
  });
});