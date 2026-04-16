import type { Note, SessionThread } from '../types';
import { describe, expect, it } from 'vitest';

import {
  buildThreadContextNotes,
  getActiveToolNames,
  getToolPhaseClass,
  getToolPhaseLabel,
  stripSessionMetaNotes,
} from './contextPanel';

describe('contextPanel utils', () => {
  it('strips trailing session metadata comments from notes', () => {
    const notes = ['Remember follow-up items.', '<!-- ai-team:session-meta {"activatedTools":[]} -->'].join('\n');

    expect(stripSessionMetaNotes(notes)).toBe('Remember follow-up items.');
  });

  it('maps tool phases to labels and CSS classes', () => {
    expect(getToolPhaseLabel('start')).toBe('Running');
    expect(getToolPhaseClass('start')).toBe('running');
    expect(getToolPhaseLabel('result')).toBe('Completed');
    expect(getToolPhaseClass('result')).toBe('completed');
  });

  it('derives the currently active tool names from the latest events', () => {
    const activeTools = getActiveToolNames([
      { toolName: 'read_file', toolPhase: 'request', timestamp: '2026-03-09T09:00:00.000Z' },
      { toolName: 'apply_patch', toolPhase: 'start', timestamp: '2026-03-09T09:01:00.000Z' },
      { toolName: 'read_file', toolPhase: 'result', timestamp: '2026-03-09T09:02:00.000Z' },
    ]);

    expect(activeTools).toEqual(['apply_patch']);
  });

  it('uses toolResult.toolName as canonical identity when present', () => {
    const activeTools = getActiveToolNames([
      {
        toolName: 'legacy_alias',
        toolPhase: 'request',
        timestamp: '2026-03-09T09:00:00.000Z',
        toolResult: {
          toolName: 'fs_tree',
          outcome: 'result',
        },
      },
    ]);

    expect(activeTools).toEqual(['fs_tree']);
  });

  it('builds thread note items with pull-in state for non-shared sibling notes', () => {
    const thread: SessionThread = {
      rootSessionId: 'session-a',
      currentSessionId: 'session-b',
      depth: 1,
      handoffs: [],
      sessions: [
        {
          sessionId: 'session-a',
          agentIds: ['daniel-navarro'],
          agentNames: ['Daniel Navarro'],
          developerId: 'dev-1',
          title: 'Design pass',
          startedAt: '2026-03-09T07:00:00.000Z',
          lastActivityAt: '2026-03-09T08:00:00.000Z',
          previousSessionId: null,
          mergedFromSessionIds: null,
          messageCount: 2,
          messages: [],
        },
        {
          sessionId: 'session-b',
          agentIds: ['leah-brooks'],
          agentNames: ['Leah Brooks'],
          developerId: 'dev-1',
          title: 'Runtime follow-up',
          startedAt: '2026-03-09T08:10:00.000Z',
          lastActivityAt: '2026-03-09T08:30:00.000Z',
          previousSessionId: 'session-a',
          mergedFromSessionIds: null,
          messageCount: 4,
          messages: [],
        },
      ],
    };

    const ownerNote: Note = {
      id: 'note-a',
      agentId: 'daniel-navarro',
      sessionId: 'session-a',
      title: 'Architecture notes',
      content: 'Keep the UI dumb.',
      hiddenFromLlm: false,
      showOnDashboard: false,
      createdAt: '2026-03-09T07:30:00.000Z',
      updatedAt: '2026-03-09T08:31:00.000Z',
    };
    const sharedNote: Note = {
      id: 'note-b',
      agentId: 'daniel-navarro',
      sessionId: 'session-a',
      sharedSessionIds: ['session-b'],
      title: 'Shared architecture notes',
      content: 'Ship the small change set.',
      hiddenFromLlm: false,
      showOnDashboard: false,
      createdAt: '2026-03-09T07:40:00.000Z',
      updatedAt: '2026-03-09T08:32:00.000Z',
    };

    const items = buildThreadContextNotes(
      thread,
      {
        'session-a': [ownerNote, sharedNote],
        'session-b': [],
      },
      'session-b'
    );

    expect(items.map((entry) => entry.note.id)).toEqual(['note-b', 'note-a']);
    expect(items[0]).toMatchObject({
      isSharedWithCurrentSession: true,
      canPullIntoCurrentSession: false,
    });
    expect(items[1]).toMatchObject({
      isSharedWithCurrentSession: false,
      canPullIntoCurrentSession: true,
    });
    expect(items[1]?.note.sessionId).toBe('session-a');
    expect(items[1]?.ownerSession.agentNames).toEqual(['Daniel Navarro']);
  });
});