/**
 * Dev-only preview page for SessionGraph with hardcoded mock data.
 * Navigate to /dev/session-graph to see the swimlane layout without a running API server.
 */
import React, { useState } from 'react';
import { SessionGraph } from './SessionGraph';
import { SessionThread } from '../types';

// ─── Mock data ────────────────────────────────────────────────────────────────

const D = (offsetMinutes: number) =>
  new Date(new Date('2026-03-05T20:00:00Z').getTime() + offsetMinutes * 60_000).toISOString();

const MOCK_THREAD: SessionThread = {
  rootSessionId: 'sess-1',
  currentSessionId: 'sess-3',
  depth: 4,
  sessions: [
    {
      sessionId: 'sess-1',
      agentIds: ['sarah-ceeses'],
      agentNames: ['Sarah Ceeses'],
      developerId: null,
      title: 'Initial planning',
      startedAt: D(0),
      lastActivityAt: D(40),
      previousSessionId: null,
      mergedFromSessionIds: null,
      messageCount: 12,
      messages: [],
    },
    {
      sessionId: 'sess-2',
      agentIds: ['michael-brown'],
      agentNames: ['Michael Brown'],
      developerId: null,
      title: 'Implementation',
      startedAt: D(45),
      lastActivityAt: D(130),
      previousSessionId: 'sess-1',
      mergedFromSessionIds: null,
      messageCount: 31,
      messages: [],
    },
    {
      sessionId: 'sess-3',
      agentIds: ['alex-morgan'],
      agentNames: ['Alex Morgan'],
      developerId: null,
      title: 'Code review',
      startedAt: D(135),
      lastActivityAt: D(200),
      previousSessionId: 'sess-2',
      mergedFromSessionIds: null,
      messageCount: 18,
      messages: [],
    },
    {
      sessionId: 'sess-4',
      agentIds: ['sarah-ceeses'],
      agentNames: ['Sarah Ceeses'],
      developerId: null,
      title: 'QA & sign-off',
      startedAt: D(205),
      lastActivityAt: D(240),
      previousSessionId: 'sess-3',
      mergedFromSessionIds: null,
      messageCount: 9,
      messages: [],
    },
  ],
  handoffs: [
    {
      handoffId: 'ho-1',
      fromSessionId: 'sess-1',
      toSessionId: 'sess-2',
      fromAgentIds: ['sarah-ceeses'],
      toAgentIds: ['michael-brown'],
    },
    {
      handoffId: 'ho-2',
      fromSessionId: 'sess-2',
      toSessionId: 'sess-3',
      fromAgentIds: ['michael-brown'],
      toAgentIds: ['alex-morgan'],
    },
    {
      handoffId: 'ho-3',
      fromSessionId: 'sess-3',
      toSessionId: 'sess-4',
      fromAgentIds: ['alex-morgan'],
      toAgentIds: ['sarah-ceeses'],
    },
    // Ghost: Sarah handed off to an Emily session that was later deleted
    {
      handoffId: 'ho-4',
      fromSessionId: 'sess-4',
      toSessionId: 'ghost-sess-1',
      fromAgentIds: ['sarah-ceeses'],
      toAgentIds: ['emily-davis'],
    },
  ],
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SessionGraphPreview() {
  const [selectedSession, setSelectedSession] = useState<string | null>('sess-3');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', background: '#252526', borderBottom: '1px solid #3e3e42', fontSize: 12, color: '#9d9d9d', flexShrink: 0 }}>
        <strong style={{ color: '#cccccc' }}>Session Graph — Dev Preview</strong>
        {'  ·  '}Mock thread with 4 sessions + 1 ghost session (Emily Davis).
        {selectedSession && <span style={{ marginLeft: 12, color: '#007fd4' }}>Selected: {selectedSession}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <SessionGraph
          thread={MOCK_THREAD}
          activeSessionId={selectedSession}
          onSelectSession={(id) => setSelectedSession(id)}
        />
      </div>
    </div>
  );
}
