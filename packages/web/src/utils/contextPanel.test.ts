import { describe, expect, it } from 'vitest';

import {
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
});