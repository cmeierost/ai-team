import type { CSSProperties } from 'react';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { Agent, HandoffEdge, SessionNode, SessionThread } from '../../types';
import { getAgentColor } from '../../utils/color';

export const LABEL_W = 160;
export const LANE_H = 80;
export const LANE_GAP = 20;
export const TIME_AXIS_H = 36;
export const BAR_PAD = 10;
export const PX_PER_TEXT_UNIT = 4;
export const MIN_BAR_W = 48;
export const MESSAGE_DOT_SIZE = 8;
export const CHARS_PER_TEXT_UNIT = 20;
export const MIN_MESSAGE_TEXT_UNITS = 1;
export const SESSION_GAP_UNITS = 0.6;
export const MIN_SESSION_SPAN_UNITS = 4;

export interface AgentLabelData {
  agent: Agent;
  color: string;
}

export interface LaneBgData {
  color: string;
  width: number;
}

export interface SessionBarData {
  session: SessionNode;
  isCurrent: boolean;
  isGhost?: boolean;
  color: string;
  barW: number;
  onSelect: (sessionId: string, agentId: string, handoffId?: string) => void;
  targetAgentId: string;
  inboundHandoffId?: string;
  messageCount: number;
  durationLabel: string;
}

export interface TimeTickData {
  label: string;
  totalH: number;
}

export interface MessageDotData {
  color: string;
  label: string;
  isHandoff?: boolean;
}

interface SessionTimeBounds {
  start: number;
  end: number;
}

interface SessionMessagePoint {
  message: SessionNode['messages'][number];
  timestampMs: number;
  index: number;
}

interface OrderedTimelineItem {
  sessionId: string;
  timestampMs: number;
  type: 'message' | 'session';
  messageIndex?: number;
  textLength: number;
}

interface SessionSegment {
  start: number;
  end: number;
  messageCount: number;
  startTimestampMs: number;
  endTimestampMs: number;
}

interface HandoffAnchorSegment {
  nodeId: string;
  startTimestampMs: number;
  endTimestampMs: number;
}

function normalizeThreadHandoffs(thread: SessionThread): HandoffEdge[] {
  const edgeById = new Map<string, HandoffEdge>();

  thread.handoffs.forEach((handoff) => {
    edgeById.set(handoff.handoffId, {
      handoffId: handoff.handoffId,
      fromSessionId: handoff.fromSessionId ?? null,
      toSessionId: handoff.toSessionId ?? null,
      fromAgentIds: [...handoff.fromAgentIds],
      toAgentIds: [...handoff.toAgentIds],
    });
  });

  thread.sessions.forEach((session) => {
    session.messages.forEach((message) => {
      if (!message.handoffId) {
        return;
      }

      const current = edgeById.get(message.handoffId) ?? {
        handoffId: message.handoffId,
        fromSessionId: null,
        toSessionId: null,
        fromAgentIds: [],
        toAgentIds: [],
      };

      if (!current.fromSessionId && message.handoffFromSessionId) {
        current.fromSessionId = message.handoffFromSessionId;
      }
      if (!current.toSessionId && message.handoffToSessionId) {
        current.toSessionId = message.handoffToSessionId;
      }

      edgeById.set(message.handoffId, current);
    });
  });

  const sessionById = new Map(thread.sessions.map((session) => [session.sessionId, session]));

  edgeById.forEach((edge) => {
    if (edge.fromSessionId && edge.fromAgentIds.length === 0) {
      edge.fromAgentIds = sessionById.get(edge.fromSessionId)?.agentIds ?? [];
    }
    if (edge.toSessionId && edge.toAgentIds.length === 0) {
      edge.toAgentIds = sessionById.get(edge.toSessionId)?.agentIds ?? [];
    }
  });

  return Array.from(edgeById.values());
}

function getHandoffTimestampMap(thread: SessionThread): Map<string, number> {
  const timestampByHandoffId = new Map<string, number>();

  thread.sessions.forEach((session) => {
    session.messages.forEach((message) => {
      if (!message.handoffId) {
        return;
      }

      const parsedTimestamp = parseIsoToMs(message.timestamp);
      if (parsedTimestamp === null) {
        return;
      }

      const existing = timestampByHandoffId.get(message.handoffId);
      if (existing === undefined || parsedTimestamp < existing) {
        timestampByHandoffId.set(message.handoffId, parsedTimestamp);
      }
    });
  });

  return timestampByHandoffId;
}

function pickSegmentNodeForTimestamp(
  segmentNodes: HandoffAnchorSegment[] | undefined,
  timestampMs: number | undefined,
  fallbackNodeId: string
): string {
  if (!segmentNodes || segmentNodes.length === 0) {
    return fallbackNodeId;
  }

  if (timestampMs === undefined) {
    return segmentNodes[0]?.nodeId ?? fallbackNodeId;
  }

  const containing = segmentNodes.find(
    (segment) => timestampMs >= segment.startTimestampMs && timestampMs <= segment.endTimestampMs
  );
  if (containing) {
    return containing.nodeId;
  }

  const nearest = segmentNodes.reduce(
    (best, segment) => {
      const distanceToStart = Math.abs(timestampMs - segment.startTimestampMs);
      const distanceToEnd = Math.abs(timestampMs - segment.endTimestampMs);
      const distance = Math.min(distanceToStart, distanceToEnd);
      if (!best || distance < best.distance) {
        return { segment, distance };
      }
      return best;
    },
    null as null | { segment: HandoffAnchorSegment; distance: number }
  );

  return nearest?.segment.nodeId ?? fallbackNodeId;
}

export function makeMinimalAgent(id: string, name?: string): Agent {
  return { id, name: name ?? id, role: '' };
}

export function formatDuration(startMs: number, endMs: number) {
  const mins = Math.round((endMs - startMs) / 60_000);
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function getTimelineMessages(session: SessionNode): SessionNode['messages'] {
  return session.messages.filter((message) => !message.handoffId && !message.handoffType);
}

function parseIsoToMs(isoLike: string | null | undefined): number | null {
  if (!isoLike) {
    return null;
  }

  const parsed = new Date(isoLike).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getSessionTimeBounds(
  session: SessionNode,
  timelineMessages: SessionNode['messages'] = session.messages
): SessionTimeBounds {
  const parsedStart = parseIsoToMs(session.startedAt);
  const parsedEnd = parseIsoToMs(session.lastActivityAt);
  const messageTimes = timelineMessages
    .map((message) => parseIsoToMs(message.timestamp))
    .filter((timestamp): timestamp is number => timestamp !== null)
    .sort((left, right) => left - right);

  const startCandidates = [parsedStart, ...messageTimes].filter(
    (timestamp): timestamp is number => timestamp !== null
  );
  const endCandidates = [parsedEnd, ...messageTimes].filter(
    (timestamp): timestamp is number => timestamp !== null
  );

  const start = startCandidates.length > 0 ? Math.min(...startCandidates) : 0;
  const rawEnd = endCandidates.length > 0 ? Math.max(...endCandidates) : start + 60_000;

  return {
    start,
    end: Math.max(rawEnd, start + 60_000),
  };
}

function toTextUnits(textLength: number): number {
  return Math.max(textLength / CHARS_PER_TEXT_UNIT, MIN_MESSAGE_TEXT_UNITS);
}

function pickTickStepUnits(_totalUnits: number): number {
  const minimumTickDistancePx = 90;
  const targetStepUnits = minimumTickDistancePx / PX_PER_TEXT_UNIT;
  const candidates = [10, 20, 25, 50, 100, 200, 500, 1000];
  return (
    candidates.find((candidate) => candidate >= targetStepUnits) ??
    candidates[candidates.length - 1]
  );
}

export function inferGhostTimes(
  ghostId: string,
  handoffs: HandoffEdge[],
  realSessions: Map<string, SessionNode>
): { start: number; end: number } | null {
  let start: number | undefined;
  let end: number | undefined;

  handoffs.forEach((handoff) => {
    if (handoff.toSessionId === ghostId && handoff.fromSessionId) {
      const from = realSessions.get(handoff.fromSessionId);
      if (from) {
        const timestamp = new Date(from.lastActivityAt).getTime();
        if (start === undefined || timestamp > start) {
          start = timestamp;
        }
      }
    }

    if (handoff.fromSessionId === ghostId && handoff.toSessionId) {
      const to = realSessions.get(handoff.toSessionId);
      if (to) {
        const timestamp = new Date(to.startedAt).getTime();
        if (end === undefined || timestamp < end) {
          end = timestamp;
        }
      }
    }
  });

  if (start === undefined && end === undefined) {
    return null;
  }

  const fallbackDuration = 30 * 60_000;
  const resolvedStart = start ?? (end ?? fallbackDuration) - fallbackDuration;
  const resolvedEnd = end ?? (start ?? 0) + fallbackDuration;

  return { start: resolvedStart, end: Math.max(resolvedEnd, resolvedStart + 60_000) };
}

export function buildSessionGraphLayout(
  thread: SessionThread,
  activeSessionId: string | null,
  agentMap: Map<string, Agent>,
  onSelectSession: (sessionId: string, agentId: string, handoffId?: string) => void
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const handoffs = normalizeThreadHandoffs(thread);
  const handoffTimestampById = getHandoffTimestampMap(thread);

  const agentNameMap = new Map<string, string>();
  thread.sessions.forEach((session) => {
    session.agentIds.forEach((id, index) => {
      if (session.agentNames[index]) {
        agentNameMap.set(id, session.agentNames[index]);
      }
    });
  });
  agentMap.forEach((agent) => {
    if (!agentNameMap.has(agent.id)) {
      agentNameMap.set(agent.id, agent.name);
    }
  });

  const realSessionMap = new Map(thread.sessions.map((session) => [session.sessionId, session]));
  const ghostAgentIds = new Map<string, string[]>();
  const ghostTimes = new Map<string, { start: number; end: number }>();

  handoffs.forEach((handoff) => {
    (
      [
        { id: handoff.fromSessionId, agentIds: handoff.fromAgentIds },
        { id: handoff.toSessionId, agentIds: handoff.toAgentIds },
      ] as const
    ).forEach(({ id, agentIds }) => {
      if (id && !realSessionMap.has(id) && !ghostAgentIds.has(id)) {
        ghostAgentIds.set(id, agentIds);
        const ghostTime = inferGhostTimes(id, handoffs, realSessionMap);
        if (ghostTime) {
          ghostTimes.set(id, ghostTime);
        }
      }
    });
  });

  const agentOrder: string[] = [];
  const seenAgents = new Set<string>();
  const addAgent = (id: string) => {
    if (id && !seenAgents.has(id)) {
      seenAgents.add(id);
      agentOrder.push(id);
    }
  };

  thread.sessions.forEach((session) => session.agentIds.forEach(addAgent));
  ghostAgentIds.forEach((agentIds) => agentIds.forEach(addAgent));

  if (agentOrder.length === 0) {
    return { nodes, edges };
  }

  const rowY = (agentId: string) => {
    const index = Math.max(0, agentOrder.indexOf(agentId));
    return TIME_AXIS_H + index * (LANE_H + LANE_GAP);
  };

  const timelineMessagesBySession = new Map<string, SessionNode['messages']>();
  thread.sessions.forEach((session) => {
    timelineMessagesBySession.set(session.sessionId, getTimelineMessages(session));
  });

  const visibleMessageCountBySession = new Map<string, number>();
  thread.sessions.forEach((session) => {
    visibleMessageCountBySession.set(
      session.sessionId,
      timelineMessagesBySession.get(session.sessionId)?.length ?? 0
    );
  });

  const sessionTimeBounds = new Map<string, SessionTimeBounds>();
  thread.sessions.forEach((session) => {
    sessionTimeBounds.set(
      session.sessionId,
      getSessionTimeBounds(
        session,
        timelineMessagesBySession.get(session.sessionId) ?? session.messages
      )
    );
  });
  ghostTimes.forEach((time, id) => {
    sessionTimeBounds.set(id, {
      start: time.start,
      end: Math.max(time.end, time.start + 60_000),
    });
    visibleMessageCountBySession.set(id, 0);
  });

  const orderedTimelineItems: OrderedTimelineItem[] = [];
  const sessionMessagesById = new Map<string, SessionMessagePoint[]>();

  thread.sessions.forEach((session) => {
    const sortedMessages = (timelineMessagesBySession.get(session.sessionId) ?? session.messages)
      .map((message, index) => ({ message, timestampMs: parseIsoToMs(message.timestamp), index }))
      .filter(
        (
          entry
        ): entry is {
          message: SessionNode['messages'][number];
          timestampMs: number;
          index: number;
        } => entry.timestampMs !== null
      )
      .sort((left, right) => left.timestampMs - right.timestampMs || left.index - right.index);

    sessionMessagesById.set(session.sessionId, sortedMessages);

    if (sortedMessages.length === 0) {
      const bounds = sessionTimeBounds.get(session.sessionId);
      orderedTimelineItems.push({
        sessionId: session.sessionId,
        timestampMs: bounds?.start ?? 0,
        type: 'session',
        textLength: Math.max(
          (visibleMessageCountBySession.get(session.sessionId) ?? 0) * CHARS_PER_TEXT_UNIT,
          CHARS_PER_TEXT_UNIT * MIN_SESSION_SPAN_UNITS
        ),
      });
      return;
    }

    sortedMessages.forEach((entry) => {
      orderedTimelineItems.push({
        sessionId: session.sessionId,
        timestampMs: entry.timestampMs,
        type: 'message',
        messageIndex: entry.index,
        textLength: Math.max(entry.message.content?.trim().length ?? 0, 1),
      });
    });
  });

  ghostAgentIds.forEach((_, ghostId) => {
    const bounds = sessionTimeBounds.get(ghostId);
    orderedTimelineItems.push({
      sessionId: ghostId,
      timestampMs: bounds?.start ?? 0,
      type: 'session',
      textLength: CHARS_PER_TEXT_UNIT * MIN_SESSION_SPAN_UNITS,
    });
  });

  orderedTimelineItems.sort((left, right) => {
    if (left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    if (left.type !== right.type) {
      return left.type === 'message' ? -1 : 1;
    }
    if (left.sessionId !== right.sessionId) {
      return left.sessionId.localeCompare(right.sessionId);
    }
    return (left.messageIndex ?? 0) - (right.messageIndex ?? 0);
  });

  const messageCenterUnits = new Map<string, number>();
  const sessionSegments = new Map<string, SessionSegment[]>();
  const primarySessionNodeId = new Map<string, string>();
  let cursorUnits = 0;
  let lastTimelineSessionId: string | null = null;

  const pushSessionSegment = (
    sessionId: string,
    start: number,
    end: number,
    isMessageItem: boolean,
    timestampMs: number
  ) => {
    const segments = sessionSegments.get(sessionId) ?? [];
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : undefined;

    if (lastSegment && lastTimelineSessionId === sessionId) {
      lastSegment.end = end;
      lastSegment.endTimestampMs = Math.max(lastSegment.endTimestampMs, timestampMs);
      if (isMessageItem) {
        lastSegment.messageCount += 1;
      }
    } else {
      segments.push({
        start,
        end,
        messageCount: isMessageItem ? 1 : 0,
        startTimestampMs: timestampMs,
        endTimestampMs: timestampMs,
      });
      sessionSegments.set(sessionId, segments);
    }

    lastTimelineSessionId = sessionId;
  };

  orderedTimelineItems.forEach((item) => {
    const itemUnits =
      item.type === 'message'
        ? toTextUnits(item.textLength)
        : Math.max(toTextUnits(item.textLength), MIN_SESSION_SPAN_UNITS);
    const start = cursorUnits;
    const end = start + itemUnits;
    const center = (start + end) / 2;

    if (item.type === 'message' && item.messageIndex !== undefined) {
      messageCenterUnits.set(`${item.sessionId}:${item.messageIndex}`, center);
    }

    pushSessionSegment(item.sessionId, start, end, item.type === 'message', item.timestampMs);
    cursorUnits = end + SESSION_GAP_UNITS;
  });

  if (cursorUnits <= 0) {
    cursorUnits = MIN_SESSION_SPAN_UNITS;
  }

  const unitsToX = (units: number) => LABEL_W + 20 + units * PX_PER_TEXT_UNIT;
  const totalWidth = unitsToX(cursorUnits) + 36;
  const totalLanesHeight = agentOrder.length * (LANE_H + LANE_GAP);

  agentOrder.forEach((agentId) => {
    const agent = agentMap.get(agentId) ?? makeMinimalAgent(agentId, agentNameMap.get(agentId));
    const color = getAgentColor(agent);
    nodes.push({
      id: `lane-${agentId}`,
      type: 'laneBg',
      position: { x: LABEL_W, y: rowY(agentId) },
      data: { color, width: totalWidth - LABEL_W } as unknown as Record<string, unknown>,
      style: {
        '--sg-lane-color': color,
        '--sg-lane-width': `${totalWidth - LABEL_W}px`,
        '--sg-lane-height': `${LANE_H}px`,
      } as CSSProperties,
      draggable: false,
      selectable: false,
      zIndex: -1,
    });
  });

  agentOrder.forEach((agentId) => {
    const agent = agentMap.get(agentId) ?? makeMinimalAgent(agentId, agentNameMap.get(agentId));
    const color = getAgentColor(agent);
    nodes.push({
      id: `label-${agentId}`,
      type: 'agentLabel',
      position: { x: 0, y: rowY(agentId) },
      data: { agent, color } as unknown as Record<string, unknown>,
      style: {
        width: LABEL_W,
        height: LANE_H,
        '--sg-lane-color': color,
      } as CSSProperties,
      draggable: false,
      selectable: false,
    });
  });

  const tickStepUnits = pickTickStepUnits(cursorUnits);
  for (let tickUnits = 0; tickUnits <= cursorUnits; tickUnits += tickStepUnits) {
    nodes.push({
      id: `tick-${tickUnits}`,
      type: 'timeTick',
      position: { x: unitsToX(tickUnits), y: 0 },
      data: {
        label: `${Math.round(tickUnits * CHARS_PER_TEXT_UNIT)}`,
        totalH: TIME_AXIS_H + totalLanesHeight,
      } as unknown as Record<string, unknown>,
      style: {
        '--sg-tick-height': `${TIME_AXIS_H + totalLanesHeight}px`,
        '--sg-tick-line-height': `${totalLanesHeight}px`,
      } as CSSProperties,
      draggable: false,
      selectable: false,
      zIndex: -1,
    });
  }

  const firstMessageNodeIdBySession = new Map<string, string>();
  const lastMessageNodeIdBySession = new Map<string, string>();
  const handoffSegmentNodesBySession = new Map<string, HandoffAnchorSegment[]>();

  const messageTrackOffsetY = LANE_H - MESSAGE_DOT_SIZE - 8;

  thread.sessions.forEach((session) => {
    const agentId = session.agentIds[0];
    if (!agentId) {
      return;
    }

    const isCurrent =
      session.sessionId === activeSessionId || session.sessionId === thread.currentSessionId;
    const agent = agentMap.get(agentId) ?? makeMinimalAgent(agentId, session.agentNames[0]);
    const color = getAgentColor(agent);
    const bounds = sessionTimeBounds.get(session.sessionId) ?? getSessionTimeBounds(session);
    const sessionStartMs = bounds.start;
    const sessionEndMs = bounds.end;
    const inboundEdge = handoffs.find((handoff) => handoff.toSessionId === session.sessionId);

    const sortedMessages = sessionMessagesById.get(session.sessionId) ?? [];

    sortedMessages.forEach((entry, index) => {
      const message = entry.message;
      const messageNodeId = `msg-${session.sessionId}-${index}`;
      const messageXUnits = messageCenterUnits.get(`${session.sessionId}:${entry.index}`) ?? 0;

      nodes.push({
        id: messageNodeId,
        type: 'messageDot',
        position: {
          x: unitsToX(messageXUnits) - MESSAGE_DOT_SIZE / 2,
          y: rowY(agentId) + messageTrackOffsetY,
        },
        data: {
          color,
          label: `${message.isHuman ? 'developer' : 'agent'} · ${Math.max(message.content?.trim().length ?? 0, 0)} chars`,
          isHandoff: Boolean(message.handoffId),
        } as unknown as Record<string, unknown>,
        style: {
          '--sg-message-color': color,
        } as CSSProperties,
        draggable: false,
        selectable: false,
      });

      if (index > 0) {
        edges.push({
          id: `msg-flow-${session.sessionId}-${index}`,
          source: `msg-${session.sessionId}-${index - 1}`,
          target: messageNodeId,
          type: 'smoothstep',
          animated: false,
          style: {
            stroke: color,
            strokeWidth: 1,
            opacity: 0.35,
          },
        });
      }

      if (index === 0) {
        firstMessageNodeIdBySession.set(session.sessionId, messageNodeId);
      }

      if (index === sortedMessages.length - 1) {
        lastMessageNodeIdBySession.set(session.sessionId, messageNodeId);
      }
    });

    const segments = sessionSegments.get(session.sessionId) ?? [
      {
        start: 0,
        end: MIN_SESSION_SPAN_UNITS,
        messageCount: 0,
        startTimestampMs: sessionStartMs,
        endTimestampMs: sessionEndMs,
      },
    ];

    const sessionHandoffSegments: HandoffAnchorSegment[] = [];

    segments.forEach((segment, segmentIndex) => {
      const nodeId =
        segmentIndex === 0 ? session.sessionId : `${session.sessionId}--seg-${segmentIndex}`;
      const barW = Math.max((segment.end - segment.start) * PX_PER_TEXT_UNIT, MIN_BAR_W);
      const sessionVisibleCount = visibleMessageCountBySession.get(session.sessionId) ?? 0;
      const segmentMessageCount =
        segment.messageCount > 0 ? segment.messageCount : Math.max(sessionVisibleCount, 0);

      if (segmentIndex === 0) {
        primarySessionNodeId.set(session.sessionId, nodeId);
      }

      sessionHandoffSegments.push({
        nodeId,
        startTimestampMs: segment.startTimestampMs,
        endTimestampMs: segment.endTimestampMs,
      });

      nodes.push({
        id: nodeId,
        type: 'sessionBar',
        position: { x: unitsToX(segment.start), y: rowY(agentId) + BAR_PAD },
        data: {
          session,
          isCurrent,
          color,
          barW,
          onSelect: onSelectSession,
          targetAgentId: agentId,
          inboundHandoffId: inboundEdge?.handoffId,
          messageCount: segmentMessageCount,
          durationLabel: formatDuration(sessionStartMs, sessionEndMs),
        } as unknown as Record<string, unknown>,
        style: {
          '--sg-session-color': color,
          '--sg-session-bar-width': `${barW}px`,
          '--sg-session-bar-height': `${LANE_H - BAR_PAD * 2}px`,
        } as CSSProperties,
        draggable: false,
      });
    });

    handoffSegmentNodesBySession.set(session.sessionId, sessionHandoffSegments);
  });

  ghostAgentIds.forEach((agentIds, ghostId) => {
    const agentId = agentIds[0];
    if (!agentId) {
      return;
    }

    const agent = agentMap.get(agentId) ?? makeMinimalAgent(agentId, agentNameMap.get(agentId));
    const color = getAgentColor(agent);
    const times = ghostTimes.get(ghostId);
    const ghostStartMs = times?.start ?? 0;
    const ghostEndMs = times?.end ?? ghostStartMs + 30 * 60_000;
    const segments = sessionSegments.get(ghostId) ?? [
      {
        start: 0,
        end: MIN_SESSION_SPAN_UNITS,
        messageCount: 0,
        startTimestampMs: ghostStartMs,
        endTimestampMs: ghostEndMs,
      },
    ];

    const ghostHandoffSegments: HandoffAnchorSegment[] = [];

    const ghostSession: SessionNode = {
      sessionId: ghostId,
      agentIds: [agentId],
      agentNames: [agentNameMap.get(agentId) ?? agentId],
      developerId: null,
      title: null,
      startedAt: new Date(ghostStartMs).toISOString(),
      lastActivityAt: new Date(ghostEndMs).toISOString(),
      previousSessionId: null,
      mergedFromSessionIds: null,
      messageCount: 0,
      messages: [],
    };

    segments.forEach((segment, segmentIndex) => {
      const nodeId = segmentIndex === 0 ? ghostId : `${ghostId}--seg-${segmentIndex}`;
      const barW = Math.max((segment.end - segment.start) * PX_PER_TEXT_UNIT, MIN_BAR_W);

      if (segmentIndex === 0) {
        primarySessionNodeId.set(ghostId, nodeId);
      }

      ghostHandoffSegments.push({
        nodeId,
        startTimestampMs: segment.startTimestampMs,
        endTimestampMs: segment.endTimestampMs,
      });

      nodes.push({
        id: nodeId,
        type: 'sessionBar',
        position: { x: unitsToX(segment.start), y: rowY(agentId) + BAR_PAD },
        data: {
          session: ghostSession,
          isCurrent: false,
          isGhost: true,
          color,
          barW,
          onSelect: () => undefined,
          targetAgentId: agentId,
          messageCount: 0,
          durationLabel: formatDuration(ghostStartMs, ghostEndMs),
        } as unknown as Record<string, unknown>,
        style: {
          opacity: 0.45,
          '--sg-session-color': color,
          '--sg-session-bar-width': `${barW}px`,
          '--sg-session-bar-height': `${LANE_H - BAR_PAD * 2}px`,
        } as CSSProperties,
        draggable: false,
      });
    });

    handoffSegmentNodesBySession.set(ghostId, ghostHandoffSegments);
  });

  const allNodeIds = new Set([
    ...thread.sessions.map((session) => session.sessionId),
    ...ghostAgentIds.keys(),
  ]);
  handoffs.forEach((handoff, index) => {
    if (!handoff.fromSessionId || !handoff.toSessionId) {
      return;
    }
    if (!allNodeIds.has(handoff.fromSessionId) || !allNodeIds.has(handoff.toSessionId)) {
      return;
    }

    const handoffTimestamp = handoffTimestampById.get(handoff.handoffId);
    const sourceNodeId = pickSegmentNodeForTimestamp(
      handoffSegmentNodesBySession.get(handoff.fromSessionId),
      handoffTimestamp,
      primarySessionNodeId.get(handoff.fromSessionId) ?? handoff.fromSessionId
    );
    const targetNodeId = pickSegmentNodeForTimestamp(
      handoffSegmentNodesBySession.get(handoff.toSessionId),
      handoffTimestamp,
      primarySessionNodeId.get(handoff.toSessionId) ?? handoff.toSessionId
    );

    edges.push({
      id: `handoff-${handoff.handoffId}-${index}`,
      source: sourceNodeId,
      target: targetNodeId,
      type: 'smoothstep',
      animated: true,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: '#007fd4',
      },
      style: { stroke: '#007fd4', strokeWidth: 1.5 },
    });
  });

  return { nodes, edges };
}
