import type { CSSProperties } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { Agent, HandoffEdge, SessionNode, SessionThread } from '../../types';
import { getAgentColor } from '../../utils/color';

export const LABEL_W = 160;
export const LANE_H = 80;
export const LANE_GAP = 20;
export const TIME_AXIS_H = 36;
export const BAR_PAD = 10;
export const PX_PER_MSG = 5;
export const MIN_BAR_W = 48;
export const GHOST_MSGS = 8;

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
  durationLabel: string;
}

export interface TimeTickData {
  label: string;
  totalH: number;
}

export function makeMinimalAgent(id: string, name?: string): Agent {
  return { id, name: name ?? id, role: '' };
}

export function formatDuration(startMs: number, endMs: number) {
  const mins = Math.round((endMs - startMs) / 60_000);
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function inferGhostTimes(
  ghostId: string,
  handoffs: HandoffEdge[],
  realSessions: Map<string, SessionNode>,
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
  const resolvedStart = start ?? ((end ?? fallbackDuration) - fallbackDuration);
  const resolvedEnd = end ?? ((start ?? 0) + fallbackDuration);

  return { start: resolvedStart, end: Math.max(resolvedEnd, resolvedStart + 60_000) };
}

export function buildSessionGraphLayout(
  thread: SessionThread,
  activeSessionId: string | null,
  agentMap: Map<string, Agent>,
  onSelectSession: (sessionId: string, agentId: string, handoffId?: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

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

  thread.handoffs.forEach((handoff) => {
    ([
      { id: handoff.fromSessionId, agentIds: handoff.fromAgentIds },
      { id: handoff.toSessionId, agentIds: handoff.toAgentIds },
    ] as const).forEach(({ id, agentIds }) => {
      if (id && !realSessionMap.has(id) && !ghostAgentIds.has(id)) {
        ghostAgentIds.set(id, agentIds);
        const ghostTime = inferGhostTimes(id, thread.handoffs, realSessionMap);
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

  const sessionMsgs = new Map<string, number>();
  thread.sessions.forEach((session) => sessionMsgs.set(session.sessionId, Math.max(session.messageCount, 1)));
  ghostAgentIds.forEach((_, id) => sessionMsgs.set(id, GHOST_MSGS));

  const allSessionIds = new Set(sessionMsgs.keys());
  const successors = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  allSessionIds.forEach((id) => {
    successors.set(id, []);
    inDegree.set(id, 0);
  });

  thread.handoffs.forEach((handoff) => {
    const from = handoff.fromSessionId;
    const to = handoff.toSessionId;
    if (!from || !to || !allSessionIds.has(from) || !allSessionIds.has(to)) {
      return;
    }

    successors.get(from)?.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  });

  const startMs = new Map<string, number>();
  thread.sessions.forEach((session) => startMs.set(session.sessionId, new Date(session.startedAt).getTime()));
  ghostTimes.forEach((time, id) => startMs.set(id, time.start));

  const queue = [...allSessionIds]
    .filter((id) => (inDegree.get(id) ?? 0) === 0)
    .sort((left, right) => (startMs.get(left) ?? 0) - (startMs.get(right) ?? 0));

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      break;
    }

    topoOrder.push(nodeId);
    for (const next of successors.get(nodeId) ?? []) {
      const degree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, degree);
      if (degree === 0) {
        const insertAt = queue.findIndex((queued) => (startMs.get(queued) ?? 0) > (startMs.get(next) ?? 0));
        if (insertAt === -1) {
          queue.push(next);
        } else {
          queue.splice(insertAt, 0, next);
        }
      }
    }
  }

  allSessionIds.forEach((id) => {
    if (!topoOrder.includes(id)) {
      topoOrder.push(id);
    }
  });

  const msgOffsetMap = new Map<string, number>();
  const msgWidthMap = new Map<string, number>();
  let cumulative = 0;
  topoOrder.forEach((id) => {
    const msgs = sessionMsgs.get(id) ?? 1;
    msgOffsetMap.set(id, cumulative);
    msgWidthMap.set(id, Math.max(msgs * PX_PER_MSG, MIN_BAR_W));
    cumulative += msgs;
  });

  const msgToX = (offset: number) => LABEL_W + 20 + offset * PX_PER_MSG;
  const totalWidth = msgToX(cumulative) + 36;
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

  let cumulativeTick = 0;
  topoOrder.forEach((id) => {
    const msgs = sessionMsgs.get(id) ?? 1;
    nodes.push({
      id: `tick-${id}`,
      type: 'timeTick',
      position: { x: msgToX(cumulativeTick), y: 0 },
      data: { label: `${cumulativeTick}`, totalH: TIME_AXIS_H + totalLanesHeight } as unknown as Record<string, unknown>,
      style: {
        '--sg-tick-height': `${TIME_AXIS_H + totalLanesHeight}px`,
        '--sg-tick-line-height': `${totalLanesHeight}px`,
      } as CSSProperties,
      draggable: false,
      selectable: false,
      zIndex: -1,
    });
    cumulativeTick += msgs;
  });

  thread.sessions.forEach((session) => {
    const agentId = session.agentIds[0];
    if (!agentId) {
      return;
    }

    const isCurrent = session.sessionId === activeSessionId || session.sessionId === thread.currentSessionId;
    const agent = agentMap.get(agentId) ?? makeMinimalAgent(agentId, session.agentNames[0]);
    const color = getAgentColor(agent);
    const sessionStartMs = new Date(session.startedAt).getTime();
    const sessionEndMs = new Date(session.lastActivityAt).getTime();
    const offset = msgOffsetMap.get(session.sessionId) ?? 0;
    const inboundEdge = thread.handoffs.find((handoff) => handoff.toSessionId === session.sessionId);

    nodes.push({
      id: session.sessionId,
      type: 'sessionBar',
      position: { x: msgToX(offset), y: rowY(agentId) + BAR_PAD },
      data: {
        session,
        isCurrent,
        color,
        barW: msgWidthMap.get(session.sessionId) ?? MIN_BAR_W,
        onSelect: onSelectSession,
        targetAgentId: agentId,
        inboundHandoffId: inboundEdge?.handoffId,
        durationLabel: formatDuration(sessionStartMs, sessionEndMs),
      } as unknown as Record<string, unknown>,
      style: {
        '--sg-session-color': color,
        '--sg-session-bar-width': `${msgWidthMap.get(session.sessionId) ?? MIN_BAR_W}px`,
        '--sg-session-bar-height': `${LANE_H - BAR_PAD * 2}px`,
      } as CSSProperties,
      draggable: false,
    });
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

    nodes.push({
      id: ghostId,
      type: 'sessionBar',
      position: { x: msgToX(msgOffsetMap.get(ghostId) ?? 0), y: rowY(agentId) + BAR_PAD },
      data: {
        session: ghostSession,
        isCurrent: false,
        isGhost: true,
        color,
        barW: msgWidthMap.get(ghostId) ?? MIN_BAR_W,
        onSelect: () => undefined,
        targetAgentId: agentId,
        durationLabel: '',
      } as unknown as Record<string, unknown>,
      style: {
        opacity: 0.45,
        '--sg-session-color': color,
        '--sg-session-bar-width': `${msgWidthMap.get(ghostId) ?? MIN_BAR_W}px`,
        '--sg-session-bar-height': `${LANE_H - BAR_PAD * 2}px`,
      } as CSSProperties,
      draggable: false,
    });
  });

  const allNodeIds = new Set([...thread.sessions.map((session) => session.sessionId), ...ghostAgentIds.keys()]);
  thread.handoffs.forEach((handoff, index) => {
    if (!handoff.fromSessionId || !handoff.toSessionId) {
      return;
    }
    if (!allNodeIds.has(handoff.fromSessionId) || !allNodeIds.has(handoff.toSessionId)) {
      return;
    }

    edges.push({
      id: `handoff-${handoff.handoffId}-${index}`,
      source: handoff.fromSessionId,
      target: handoff.toSessionId,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#007fd4', strokeWidth: 1.5 },
    });
  });

  return { nodes, edges };
}