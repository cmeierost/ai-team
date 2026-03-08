import React, { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTeam } from '../context/TeamContext';
import { Agent, SessionThread, HandoffEdge, SessionNode } from '../types';
import { Avatar } from './Avatar';
import { getAgentColor } from '../utils/color';
import './SessionGraph.css';

// --- Layout constants (horizontal swimlane: X = message count, Y = agent) ---

const LABEL_W     = 160;  // px: left column width for agent labels
const LANE_H      = 80;   // px: height of each agent lane
const LANE_GAP    = 20;   // px: vertical gap between lanes
const TIME_AXIS_H = 36;   // px: top row for message-count axis
const BAR_PAD     = 10;   // px: vertical padding inside lane for the bar
const PX_PER_MSG  = 5;    // px per message — bar width proportional to message count
const MIN_BAR_W   = 48;   // px: minimum bar width (very short sessions)
const BAR_SEP     = 16;   // px: gap between consecutive bars
const GHOST_MSGS  = 8;    // assumed message count for deleted ghost sessions

// --- Helpers ---

function makeMinimalAgent(id: string, name?: string): Agent {
  return { id, name: name ?? id, role: '' };
}
function formatDuration(startMs: number, endMs: number) {
  const mins = Math.round((endMs - startMs) / 60_000);
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// --- Custom node: agent label (left column) ---

interface AgentLabelData { agent: Agent; color: string; }
function AgentLabelNode({ data }: NodeProps) {
  const d = data as unknown as AgentLabelData;
  return (
    <div className="sg-agent-label" style={{ borderRight: `3px solid ${d.color}` }}>
      <Avatar agent={d.agent} size="small" />
      <span className="sg-agent-label-name">{d.agent.name}</span>
    </div>
  );
}

// --- Custom node: lane background strip ---

interface LaneBgData { color: string; width: number; }
function LaneBgNode({ data }: NodeProps) {
  const d = data as unknown as LaneBgData;
  return (
    <div
      className="sg-lane-bg"
      style={{
        width: d.width,
        height: LANE_H,
        background: `${d.color}08`,
        borderBottom: `1px solid ${d.color}22`,
      }}
    />
  );
}

// --- Custom node: session bar (horizontal rectangle) ---

interface SessionBarData {
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
function SessionBarNode({ data }: NodeProps) {
  const d = data as unknown as SessionBarData;
  const { session, isCurrent, isGhost, color, barW, onSelect, targetAgentId, inboundHandoffId, durationLabel } = d;
  const barH = LANE_H - BAR_PAD * 2;

  return (
    <>
      <Handle type="target" position={Position.Left}  style={{ opacity: 0, top: '50%' }} />
      <div
        className={`sg-session-bar${isCurrent ? ' sg-session-bar-current' : ''}${isGhost ? ' sg-session-bar-ghost' : ''}`}
        style={{
          width: barW,
          height: barH,
          borderTop: `2px solid ${color}`,
          borderLeft: `1px solid ${isCurrent ? color : 'rgba(255,255,255,0.12)'}`,
          borderRight: `1px solid rgba(255,255,255,0.06)`,
          borderBottom: `1px solid rgba(255,255,255,0.06)`,
          background: isCurrent
            ? `linear-gradient(to bottom, ${color}30 0%, ${color}0a 100%)`
            : 'rgba(255,255,255,0.04)',
          cursor: isGhost ? 'default' : 'pointer',
        }}
        onClick={isGhost ? undefined : () => onSelect(session.sessionId, targetAgentId, inboundHandoffId)}
      >
        {isGhost ? (
          <span className="sg-session-bar-ghost-label">deleted</span>
        ) : (
          <>
            <span className="sg-session-bar-msgs">{session.messageCount}msg</span>
            <span className="sg-session-bar-dur">{durationLabel}</span>
            {isCurrent && <span className="sg-session-bar-badge" style={{ background: color }}>active</span>}
          </>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, top: '50%' }} />
    </>
  );
}

// --- Custom node: time-axis tick ---

interface TimeTickData { label: string; totalH: number; }
function TimeTickNode({ data }: NodeProps) {
  const d = data as unknown as TimeTickData;
  return (
    <div className="sg-time-tick" style={{ height: d.totalH }}>
      <div className="sg-time-tick-label">{d.label}</div>
      <div className="sg-time-tick-line" style={{ height: d.totalH - TIME_AXIS_H }} />
    </div>
  );
}

// --- Node type registry ---

const nodeTypes = {
  agentLabel: AgentLabelNode,
  laneBg:     LaneBgNode,
  sessionBar: SessionBarNode,
  timeTick:   TimeTickNode,
} as const;

// --- Ghost helper ---

function inferGhostTimes(
  ghostId: string,
  handoffs: HandoffEdge[],
  realSessions: Map<string, SessionNode>,
): { start: number; end: number } | null {
  let start: number | undefined;
  let end: number | undefined;
  handoffs.forEach((h) => {
    if (h.toSessionId === ghostId && h.fromSessionId) {
      const from = realSessions.get(h.fromSessionId);
      if (from) { const t = new Date(from.lastActivityAt).getTime(); if (start === undefined || t > start) start = t; }
    }
    if (h.fromSessionId === ghostId && h.toSessionId) {
      const to = realSessions.get(h.toSessionId);
      if (to) { const t = new Date(to.startedAt).getTime(); if (end === undefined || t < end) end = t; }
    }
  });
  if (start === undefined && end === undefined) return null;
  const FALLBACK = 30 * 60_000;
  const s = start ?? (end! - FALLBACK);
  const e = end   ?? (start! + FALLBACK);
  return { start: s, end: Math.max(e, s + 60_000) };
}

// --- Layout builder ---

function buildLayout(
  thread: SessionThread,
  activeSessionId: string | null,
  agentMap: Map<string, Agent>,
  onSelectSession: (sessionId: string, agentId: string, handoffId?: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // agent name map
  const agentNameMap = new Map<string, string>();
  thread.sessions.forEach((s) => {
    s.agentIds.forEach((id, i) => { if (s.agentNames[i]) agentNameMap.set(id, s.agentNames[i]); });
  });
  agentMap.forEach((a) => { if (!agentNameMap.has(a.id)) agentNameMap.set(a.id, a.name); });

  // ghost sessions
  const realSessionMap = new Map(thread.sessions.map((s) => [s.sessionId, s]));
  const ghostAgentIds  = new Map<string, string[]>();
  const ghostTimes     = new Map<string, { start: number; end: number }>();
  thread.handoffs.forEach((h) => {
    ([{ id: h.fromSessionId, aIds: h.fromAgentIds }, { id: h.toSessionId, aIds: h.toAgentIds }] as const).forEach(
      ({ id, aIds }) => {
        if (id && !realSessionMap.has(id) && !ghostAgentIds.has(id)) {
          ghostAgentIds.set(id, aIds);
          const t = inferGhostTimes(id, thread.handoffs, realSessionMap);
          if (t) ghostTimes.set(id, t);
        }
      },
    );
  });

  // agent row order (topological via handoffs)
  const agentOrder: string[] = [];
  const seenAgents = new Set<string>();
  const addAgent = (id: string) => { if (id && !seenAgents.has(id)) { seenAgents.add(id); agentOrder.push(id); } };
  thread.sessions.forEach((s) => s.agentIds.forEach(addAgent));
  ghostAgentIds.forEach((aIds) => aIds.forEach(addAgent));

  if (agentOrder.length === 0) return { nodes, edges };

  const rowY = (agentId: string) => {
    const idx = Math.max(0, agentOrder.indexOf(agentId));
    return TIME_AXIS_H + idx * (LANE_H + LANE_GAP);
  };

  // Message-count-based layout ordered by handoff-chain (topological sort).
  // Each session's X = cumulative messages of all predecessors in the chain.
  // Bar width = own message count * PX_PER_MSG.
  const sessionMsgs = new Map<string, number>();
  thread.sessions.forEach((s) => sessionMsgs.set(s.sessionId, Math.max(s.messageCount, 1)));
  ghostAgentIds.forEach((_, id) => sessionMsgs.set(id, GHOST_MSGS));

  const allSessionIds = new Set(sessionMsgs.keys());

  // Build adjacency + in-degree for Kahn's topological sort
  const successors  = new Map<string, string[]>(); // from → [to, ...]
  const inDegree    = new Map<string, number>();
  allSessionIds.forEach((id) => { successors.set(id, []); inDegree.set(id, 0); });

  thread.handoffs.forEach((h) => {
    const from = h.fromSessionId;
    const to   = h.toSessionId;
    if (!from || !to || !allSessionIds.has(from) || !allSessionIds.has(to)) return;
    successors.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  });

  // Kahn's algorithm — break ties by session start time for stable order
  const startMs = new Map<string, number>();
  thread.sessions.forEach((s) => startMs.set(s.sessionId, new Date(s.startedAt).getTime()));
  ghostTimes.forEach((t, id) => startMs.set(id, t.start));

  const queue = [...allSessionIds]
    .filter((id) => (inDegree.get(id) ?? 0) === 0)
    .sort((a, b) => (startMs.get(a) ?? 0) - (startMs.get(b) ?? 0));

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    topoOrder.push(node);
    for (const next of (successors.get(node) ?? [])) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) {
        // insert in start-time order
        const insertAt = queue.findIndex((q) => (startMs.get(q) ?? 0) > (startMs.get(next) ?? 0));
        if (insertAt === -1) queue.push(next); else queue.splice(insertAt, 0, next);
      }
    }
  }
  // append any nodes not reachable (disconnected), sorted by time
  allSessionIds.forEach((id) => { if (!topoOrder.includes(id)) topoOrder.push(id); });

  // Assign X offsets in topo order
  const msgOffsetMap = new Map<string, number>();
  const msgWidthMap  = new Map<string, number>();
  let cumulative = 0;
  topoOrder.forEach((id) => {
    const msgs = sessionMsgs.get(id) ?? 1;
    msgOffsetMap.set(id, cumulative);
    msgWidthMap.set(id, Math.max(msgs * PX_PER_MSG, MIN_BAR_W));
    cumulative += msgs;
  });

  const msgToX      = (offset: number) => LABEL_W + 20 + offset * PX_PER_MSG;
  const totalW      = msgToX(cumulative) + BAR_SEP + 20;
  const totalLanesH = agentOrder.length * (LANE_H + LANE_GAP);

  // lane backgrounds
  agentOrder.forEach((agentId) => {
    const agent = agentMap.get(agentId) ?? makeMinimalAgent(agentId, agentNameMap.get(agentId));
    const color = getAgentColor(agent);
    nodes.push({
      id: `lane-${agentId}`,
      type: 'laneBg',
      position: { x: LABEL_W, y: rowY(agentId) },
      data: { color, width: totalW - LABEL_W } as unknown as Record<string, unknown>,
      draggable: false,
      selectable: false,
      zIndex: -1,
    });
  });

  // agent label nodes (left column)
  agentOrder.forEach((agentId) => {
    const agent = agentMap.get(agentId) ?? makeMinimalAgent(agentId, agentNameMap.get(agentId));
    const color = getAgentColor(agent);
    nodes.push({
      id: `label-${agentId}`,
      type: 'agentLabel',
      position: { x: 0, y: rowY(agentId) },
      data: { agent, color } as unknown as Record<string, unknown>,
      style: { width: LABEL_W, height: LANE_H },
      draggable: false,
      selectable: false,
    });
  });

  // message-count axis ticks — one per session in topo order, label = cumulative msg index
  let cumulTick = 0;
  topoOrder.forEach((id) => {
    const msgs = sessionMsgs.get(id) ?? 1;
    nodes.push({
      id: `tick-${id}`,
      type: 'timeTick',
      position: { x: msgToX(cumulTick), y: 0 },
      data: { label: `${cumulTick}`, totalH: TIME_AXIS_H + totalLanesH } as unknown as Record<string, unknown>,
      draggable: false,
      selectable: false,
      zIndex: -1,
    });
    cumulTick += msgs;
  });

  // real session bars
  thread.sessions.forEach((session) => {
    const agentId = session.agentIds[0];
    if (!agentId) return;
    const isCurrent = session.sessionId === thread.currentSessionId;
    const agent     = agentMap.get(agentId) ?? makeMinimalAgent(agentId, session.agentNames[0]);
    const color     = getAgentColor(agent);
    const startMs   = new Date(session.startedAt).getTime();
    const endMs     = new Date(session.lastActivityAt).getTime();
    const offset    = msgOffsetMap.get(session.sessionId) ?? 0;
    const xLeft     = msgToX(offset);
    const barW      = msgWidthMap.get(session.sessionId) ?? MIN_BAR_W;
    const yBar      = rowY(agentId) + BAR_PAD;
    const inboundEdge = thread.handoffs.find((h) => h.toSessionId === session.sessionId);

    nodes.push({
      id: session.sessionId,
      type: 'sessionBar',
      position: { x: xLeft, y: yBar },
      data: {
        session, isCurrent, color, barW,
        onSelect: onSelectSession,
        targetAgentId: agentId,
        inboundHandoffId: inboundEdge?.handoffId,
        durationLabel: formatDuration(startMs, endMs),
      } as unknown as Record<string, unknown>,
      draggable: false,
    });
  });

  // ghost session bars
  ghostAgentIds.forEach((aIds, ghostId) => {
    const agentId = aIds[0];
    if (!agentId) return;
    const agent   = agentMap.get(agentId) ?? makeMinimalAgent(agentId, agentNameMap.get(agentId));
    const color   = getAgentColor(agent);
    const times   = ghostTimes.get(ghostId);
    const startMs = times?.start ?? 0;
    const endMs   = times?.end   ?? startMs + 30 * 60_000;
    const offset  = msgOffsetMap.get(ghostId) ?? 0;
    const xLeft   = msgToX(offset);
    const barW    = msgWidthMap.get(ghostId) ?? MIN_BAR_W;
    const yBar    = rowY(agentId) + BAR_PAD;

    const ghostSession: SessionNode = {
      sessionId: ghostId,
      agentIds: [agentId],
      agentNames: [agentNameMap.get(agentId) ?? agentId],
      developerId: null, title: null,
      startedAt: new Date(startMs).toISOString(),
      lastActivityAt: new Date(endMs).toISOString(),
      previousSessionId: null, mergedFromSessionIds: null,
      messageCount: 0, messages: [],
    };

    nodes.push({
      id: ghostId,
      type: 'sessionBar',
      position: { x: xLeft, y: yBar },
      data: {
        session: ghostSession, isCurrent: false, isGhost: true,
        color, barW, onSelect: () => {}, targetAgentId: agentId, durationLabel: '',
      } as unknown as Record<string, unknown>,
      style: { opacity: 0.45 },
      draggable: false,
    });
  });

  // edges
  const allNodeIds = new Set([
    ...thread.sessions.map((s) => s.sessionId),
    ...ghostAgentIds.keys(),
  ]);
  thread.handoffs.forEach((h, idx) => {
    if (!h.fromSessionId || !h.toSessionId) return;
    if (!allNodeIds.has(h.fromSessionId) || !allNodeIds.has(h.toSessionId)) return;
    edges.push({
      id: `handoff-${h.handoffId}-${idx}`,
      source: h.fromSessionId,
      target: h.toSessionId,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#007fd4', strokeWidth: 1.5 },
    });
  });

  return { nodes, edges };
}

// --- SessionGraph component ---

interface SessionGraphProps {
  thread: SessionThread;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string, agentId: string, handoffId?: string) => void;
}

export function SessionGraph({ thread, activeSessionId, onSelectSession }: SessionGraphProps) {
  const { agents } = useTeam();

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    agents.forEach((a) => m.set(a.id, a));
    return m;
  }, [agents]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildLayout(thread, activeSessionId, agentMap, onSelectSession),
    [thread, activeSessionId, agentMap, onSelectSession],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="session-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        attributionPosition="bottom-left"
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.15}
        maxZoom={3}
      >
        <Background color="#2a2a2a" gap={24} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={2}
          style={{ background: '#1e1e1e', border: '1px solid #3e3e42' }}
          maskColor="rgba(0,0,0,0.4)"
        />
      </ReactFlow>
    </div>
  );
}

// --- SessionGraphLoader ---

interface SessionGraphLoaderProps {
  sessionId: string;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string, agentId: string, handoffId?: string) => void;
}

export function SessionGraphLoader({ sessionId, activeSessionId, onSelectSession }: SessionGraphLoaderProps) {
  const { client } = useTeam();
  const [thread, setThread] = useState<SessionThread | null>(null);
  const [loadingThread, setLoadingThread] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingThread(true);
    setThreadError(null);
    client
      .getSessionThread(sessionId)
      .then((data) => { if (!cancelled) setThread(data); })
      .catch((err: Error) => { if (!cancelled) setThreadError(err.message); })
      .finally(() => { if (!cancelled) setLoadingThread(false); });
    return () => { cancelled = true; };
  }, [sessionId, client]);

  if (loadingThread) {
    return (
      <div className="session-graph-state">
        <div className="session-graph-state-text">Loading session thread&hellip;</div>
      </div>
    );
  }
  if (threadError || !thread) {
    return (
      <div className="session-graph-state">
        <div className="session-graph-state-text session-graph-state-error">
          Failed to load session thread{threadError ? `: ${threadError}` : ''}
        </div>
      </div>
    );
  }
  if (thread.sessions.length === 0) {
    return (
      <div className="session-graph-state">
        <div className="session-graph-state-text">No sessions found in this thread.</div>
      </div>
    );
  }
  return (
    <SessionGraph
      thread={thread}
      activeSessionId={activeSessionId}
      onSelectSession={onSelectSession}
    />
  );
}
