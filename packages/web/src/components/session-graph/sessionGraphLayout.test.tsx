import { describe, expect, it, vi } from 'vitest';
import { MarkerType } from '@xyflow/react';
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
  it('creates lane, label, tick, bar, and handoff/message connector edges for a thread', () => {
    const result = buildSessionGraphLayout(thread, 'session-3', agents, vi.fn());

    expect(result.nodes.some((node) => node.id === 'lane-sarah-lee')).toBe(true);
    expect(result.nodes.some((node) => node.id === 'label-daniel-navarro')).toBe(true);
    expect(result.nodes.some((node) => node.type === 'timeTick')).toBe(true);
    expect(result.nodes.some((node) => node.id === 'session-3')).toBe(true);
    expect(result.edges.length).toBeGreaterThanOrEqual(2);

    const handoffEdges = result.edges.filter((edge) => edge.id.startsWith('handoff-'));
    expect(handoffEdges.length).toBeGreaterThan(0);
    handoffEdges.forEach((edge) => {
      expect(edge.markerEnd).toMatchObject({ type: MarkerType.ArrowClosed });
      expect(edge.source.startsWith('msg-')).toBe(false);
      expect(edge.target.startsWith('msg-')).toBe(false);
    });
  });

  it('places session bars in chronological order along the horizontal axis', () => {
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

  it('creates message nodes and links them in time order within each session', () => {
    const threadWithMessages: SessionThread = {
      ...thread,
      sessions: thread.sessions.map((session, index) => ({
        ...session,
        messages: [
          {
            from: 'dev',
            isHuman: true,
            content: `msg-a-${index}`,
            timestamp: new Date(Date.parse(session.startedAt) + 60_000).toISOString(),
          },
          {
            from: session.agentIds[0] ?? 'agent',
            isHuman: false,
            content: `msg-b-${index}`,
            timestamp: new Date(Date.parse(session.startedAt) + 120_000).toISOString(),
          },
        ],
      })),
    };

    const result = buildSessionGraphLayout(threadWithMessages, 'session-3', agents, vi.fn());
    const firstMessageNode = result.nodes.find((node) => node.id === 'msg-session-1-0');
    const secondMessageNode = result.nodes.find((node) => node.id === 'msg-session-1-1');

    expect(firstMessageNode).toBeDefined();
    expect(secondMessageNode).toBeDefined();
    expect(firstMessageNode!.position.x).toBeLessThan(secondMessageNode!.position.x);
    expect(result.edges.some((edge) => edge.id === 'msg-flow-session-1-1')).toBe(true);
  });

  it('scales session span by message text volume', () => {
    const threadWithTextVolume: SessionThread = {
      ...thread,
      sessions: [
        {
          ...thread.sessions[0],
          messageCount: 2,
          messages: [
            {
              from: 'dev',
              isHuman: true,
              content: 'short',
              timestamp: new Date(Date.parse(thread.sessions[0].startedAt) + 30_000).toISOString(),
            },
            {
              from: 'sarah-lee',
              isHuman: false,
              content: 'tiny',
              timestamp: new Date(Date.parse(thread.sessions[0].startedAt) + 60_000).toISOString(),
            },
          ],
        },
        {
          ...thread.sessions[1],
          messageCount: 2,
          messages: [
            {
              from: 'dev',
              isHuman: true,
              content: 'long-message '.repeat(140),
              timestamp: new Date(Date.parse(thread.sessions[1].startedAt) + 30_000).toISOString(),
            },
            {
              from: 'daniel-navarro',
              isHuman: false,
              content: 'long-response '.repeat(120),
              timestamp: new Date(Date.parse(thread.sessions[1].startedAt) + 60_000).toISOString(),
            },
          ],
        },
        {
          ...thread.sessions[2],
          messageCount: 1,
          messages: [],
        },
      ],
    };

    const result = buildSessionGraphLayout(threadWithTextVolume, 'session-3', agents, vi.fn());
    const shortSession = result.nodes.find((node) => node.id === 'session-1');
    const longSession = result.nodes.find((node) => node.id === 'session-2');

    const shortWidth = (shortSession?.data as { barW?: number })?.barW ?? 0;
    const longWidth = (longSession?.data as { barW?: number })?.barW ?? 0;

    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  it('marks the active session bar in its node data', () => {
    const result = buildSessionGraphLayout(thread, 'session-3', agents, vi.fn());

    const currentNode = result.nodes.find((node) => node.id === 'session-3');
    const earlierNode = result.nodes.find((node) => node.id === 'session-1');

    expect((currentNode?.data as { isCurrent?: boolean }).isCurrent).toBe(true);
    expect((earlierNode?.data as { isCurrent?: boolean }).isCurrent).toBe(false);
  });

  it('renders separate bar segments when a session re-enters after another session', () => {
    const reentryThread: SessionThread = {
      ...thread,
      sessions: [
        {
          ...thread.sessions[0],
          sessionId: 'session-emily',
          agentIds: ['clara-bishop'],
          agentNames: ['Emily Davis'],
          messages: [
            {
              from: 'dev',
              isHuman: true,
              content: 'first touch with emily',
              timestamp: '2026-03-09T09:00:00.000Z',
            },
            {
              from: 'clara-bishop',
              isHuman: false,
              content: 'back again after michael',
              timestamp: '2026-03-09T09:20:00.000Z',
            },
          ],
        },
        {
          ...thread.sessions[1],
          sessionId: 'session-michael',
          agentIds: ['daniel-navarro'],
          agentNames: ['Michael Brown'],
          messages: [
            {
              from: 'dev',
              isHuman: true,
              content: 'middle section with michael',
              timestamp: '2026-03-09T09:10:00.000Z',
            },
          ],
        },
      ],
      handoffs: [
        {
          handoffId: 'handoff-emily-to-michael',
          fromSessionId: 'session-emily',
          toSessionId: 'session-michael',
          fromAgentIds: ['clara-bishop'],
          toAgentIds: ['daniel-navarro'],
        },
      ],
      currentSessionId: 'session-emily',
    };

    const result = buildSessionGraphLayout(reentryThread, 'session-emily', agents, vi.fn());

    const emilyFirstSegment = result.nodes.find((node) => node.id === 'session-emily');
    const emilySecondSegment = result.nodes.find((node) => node.id === 'session-emily--seg-1');
    const michaelSegment = result.nodes.find((node) => node.id === 'session-michael');

    expect(emilyFirstSegment).toBeDefined();
    expect(emilySecondSegment).toBeDefined();
    expect(michaelSegment).toBeDefined();

    expect(emilyFirstSegment!.position.x).toBeLessThan(michaelSegment!.position.x);
    expect(michaelSegment!.position.x).toBeLessThan(emilySecondSegment!.position.x);

    const firstEmilyCount = (emilyFirstSegment?.data as { messageCount?: number } | undefined)
      ?.messageCount;
    const secondEmilyCount = (emilySecondSegment?.data as { messageCount?: number } | undefined)
      ?.messageCount;
    const michaelCount = (michaelSegment?.data as { messageCount?: number } | undefined)
      ?.messageCount;

    expect(firstEmilyCount).toBe(1);
    expect(secondEmilyCount).toBe(1);
    expect(michaelCount).toBe(1);
  });

  it('filters handoff messages from timeline nodes and segment counts', () => {
    const threadWithHandoffMessages: SessionThread = {
      ...thread,
      sessions: [
        {
          ...thread.sessions[0],
          sessionId: 'session-a',
          messages: [
            {
              from: 'agent-a',
              isHuman: false,
              content: 'handoff briefing copy',
              timestamp: '2026-03-09T09:00:00.000Z',
              handoffId: 'handoff-dup',
              handoffType: 'agent-briefing',
            },
            {
              from: 'dev',
              isHuman: true,
              content: 'real message in session a',
              timestamp: '2026-03-09T09:01:00.000Z',
            },
          ],
        },
        {
          ...thread.sessions[1],
          sessionId: 'session-b',
          messages: [
            {
              from: 'agent-a',
              isHuman: false,
              content: 'handoff briefing copy',
              timestamp: '2026-03-09T09:00:00.000Z',
              handoffId: 'handoff-dup',
              handoffType: 'agent-briefing',
            },
            {
              from: 'dev',
              isHuman: true,
              content: 'real message in session b',
              timestamp: '2026-03-09T09:02:00.000Z',
            },
          ],
        },
      ],
      handoffs: [
        {
          handoffId: 'handoff-dup',
          fromSessionId: 'session-a',
          toSessionId: 'session-b',
          fromAgentIds: ['sarah-lee'],
          toAgentIds: ['daniel-navarro'],
        },
      ],
      currentSessionId: 'session-b',
    };

    const result = buildSessionGraphLayout(threadWithHandoffMessages, 'session-b', agents, vi.fn());

    const msgNodes = result.nodes.filter((node) => node.id.startsWith('msg-'));
    expect(msgNodes).toHaveLength(2);

    const sessionABar = result.nodes.find((node) => node.id === 'session-a');
    const sessionBBar = result.nodes.find((node) => node.id === 'session-b');

    expect((sessionABar?.data as { messageCount?: number } | undefined)?.messageCount).toBe(1);
    expect((sessionBBar?.data as { messageCount?: number } | undefined)?.messageCount).toBe(1);
  });

  it('draws handoff connectors when thread handoffs are missing to-session but messages provide it', () => {
    const brokenThreadPayload: SessionThread = {
      ...thread,
      sessions: [
        {
          ...thread.sessions[0],
          sessionId: 'session-source',
          agentIds: ['sarah-lee'],
          agentNames: ['Sarah Lee'],
          messages: [
            {
              from: 'sarah-lee',
              isHuman: false,
              content: 'handoff briefing',
              timestamp: '2026-03-09T09:00:00.000Z',
              handoffId: 'handoff-missing-target',
              handoffType: 'agent-briefing',
              handoffFromSessionId: 'session-source',
              handoffToSessionId: 'session-target',
            },
          ],
        },
        {
          ...thread.sessions[1],
          sessionId: 'session-target',
          agentIds: ['daniel-navarro'],
          agentNames: ['Daniel Navarro'],
          messages: [
            {
              from: 'dev',
              isHuman: true,
              content: 'target real message',
              timestamp: '2026-03-09T09:02:00.000Z',
            },
          ],
        },
      ],
      handoffs: [
        {
          handoffId: 'handoff-missing-target',
          fromSessionId: 'session-source',
          toSessionId: null,
          fromAgentIds: ['sarah-lee'],
          toAgentIds: [],
        },
      ],
      currentSessionId: 'session-target',
    };

    const result = buildSessionGraphLayout(brokenThreadPayload, 'session-target', agents, vi.fn());
    const repairedHandoffEdge = result.edges.find(
      (edge) => edge.id === 'handoff-handoff-missing-target-0'
    );

    expect(repairedHandoffEdge).toBeDefined();
    expect(repairedHandoffEdge?.source).toBe('session-source');
    expect(repairedHandoffEdge?.target).toBe('session-target');
  });

  it('anchors handoff connectors to the correct session segment on re-entry timelines', () => {
    const reentryWithHandoffs: SessionThread = {
      ...thread,
      sessions: [
        {
          ...thread.sessions[0],
          sessionId: 'session-emily',
          agentIds: ['clara-bishop'],
          agentNames: ['Emily Davis'],
          messages: [
            {
              from: 'dev',
              isHuman: true,
              content: 'first emily message',
              timestamp: '2026-03-09T09:00:00.000Z',
            },
            {
              from: 'clara-bishop',
              isHuman: false,
              content: 'handoff to michael',
              timestamp: '2026-03-09T09:05:00.000Z',
              handoffId: 'handoff-emily-to-michael',
              handoffType: 'agent-briefing',
              handoffFromSessionId: 'session-emily',
              handoffToSessionId: 'session-michael',
            },
            {
              from: 'dev',
              isHuman: true,
              content: 'emily after return',
              timestamp: '2026-03-09T09:20:00.000Z',
            },
          ],
        },
        {
          ...thread.sessions[1],
          sessionId: 'session-michael',
          agentIds: ['daniel-navarro'],
          agentNames: ['Michael Brown'],
          messages: [
            {
              from: 'dev',
              isHuman: true,
              content: 'middle michael message',
              timestamp: '2026-03-09T09:10:00.000Z',
            },
            {
              from: 'daniel-navarro',
              isHuman: false,
              content: 'handoff back to emily',
              timestamp: '2026-03-09T09:15:00.000Z',
              handoffId: 'handoff-michael-to-emily',
              handoffType: 'agent-briefing',
              handoffFromSessionId: 'session-michael',
              handoffToSessionId: 'session-emily',
            },
          ],
        },
      ],
      handoffs: [
        {
          handoffId: 'handoff-emily-to-michael',
          fromSessionId: 'session-emily',
          toSessionId: 'session-michael',
          fromAgentIds: ['clara-bishop'],
          toAgentIds: ['daniel-navarro'],
        },
        {
          handoffId: 'handoff-michael-to-emily',
          fromSessionId: 'session-michael',
          toSessionId: 'session-emily',
          fromAgentIds: ['daniel-navarro'],
          toAgentIds: ['clara-bishop'],
        },
      ],
      currentSessionId: 'session-emily',
    };

    const result = buildSessionGraphLayout(reentryWithHandoffs, 'session-emily', agents, vi.fn());
    const emilyToMichael = result.edges.find(
      (edge) => edge.id === 'handoff-handoff-emily-to-michael-0'
    );
    const michaelToEmily = result.edges.find(
      (edge) => edge.id === 'handoff-handoff-michael-to-emily-1'
    );

    expect(emilyToMichael).toBeDefined();
    expect(michaelToEmily).toBeDefined();
    expect(emilyToMichael?.source).toBe('session-emily');
    expect(emilyToMichael?.target).toBe('session-michael');
    expect(michaelToEmily?.source).toBe('session-michael');
    expect(michaelToEmily?.target).toBe('session-emily--seg-1');
  });
});
