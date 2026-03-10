import { describe, expect, it } from 'vitest';
import type { Agent, ChatMessage, SessionActivatedTool } from '../../types';
import {
  areMessagesEquivalent,
  buildSummaryMarkdown,
  extractSessionActivatedTools,
  findMatchingMessage,
  findMatchingMessageIndex,
  normalizeChatErrorMessage,
  resolveNavigateAgent,
  SESSION_META_PREFIX,
  SESSION_META_SUFFIX,
} from './chatPanelUtils';

const agents: Agent[] = [
  { id: 'daniel-navarro', name: 'Daniel Navarro', role: 'Frontend Lead' },
  { id: 'clara-bishop', name: 'Clara Bishop', role: 'Frontend Quality Engineer' },
];

describe('chatPanelUtils', () => {
  it('extracts activated tools from session notes metadata', () => {
    const activatedTools: SessionActivatedTool[] = [
      {
        toolName: 'read_file',
        toolPhase: 'result',
        message: 'Loaded ChatPanel.tsx',
        timestamp: '2026-03-09T10:00:00.000Z',
      },
    ];
    const notes = [
      'A normal note above the metadata.',
      `${SESSION_META_PREFIX}${JSON.stringify({ activatedTools })}${SESSION_META_SUFFIX}`,
    ].join('\n');

    expect(extractSessionActivatedTools(notes)).toEqual(activatedTools);
    expect(extractSessionActivatedTools('plain text only')).toEqual([]);
  });

  it('resolves forward handoff targets from handoff messages', () => {
    const handoffMessage: ChatMessage = {
      from: 'daniel-navarro',
      to: 'clara-bishop',
      content: 'HANDOFF: clara-bishop | please continue the QA pass',
      timestamp: '2026-03-09T10:10:00.000Z',
      handoffToSessionId: 'session-clara-1',
    };

    expect(resolveNavigateAgent(handoffMessage, agents, 'daniel-navarro', 'daniel-navarro')).toEqual({
      agent: agents[1],
      sessionId: 'session-clara-1',
    });
  });

  it('resolves agent briefing targets back to the originating agent', () => {
    const briefingMessage: ChatMessage = {
      from: 'daniel-navarro',
      to: 'clara-bishop',
      content: 'Context briefing for the next agent',
      timestamp: '2026-03-09T10:20:00.000Z',
      handoffType: 'agent-briefing',
      handoffFromSessionId: 'session-daniel-1',
    };

    expect(resolveNavigateAgent(briefingMessage, agents, 'clara-bishop', 'clara-bishop')).toEqual({
      agent: agents[0],
      sessionId: 'session-daniel-1',
    });
  });

  it('normalizes timeout-style chat errors and preserves other errors', () => {
    expect(normalizeChatErrorMessage('Question timeout: no response received in time')).toBe(
      'The request could not be completed. Please try again.',
    );
    expect(normalizeChatErrorMessage('Something else went wrong')).toBe('Something else went wrong');
  });

  it('builds summary markdown with developer names and separators', () => {
    const messages: ChatMessage[] = [
      {
        from: 'human',
        isHuman: true,
        content: 'Please split ChatPanel into controller and view.',
        timestamp: '2026-03-09T11:00:00.000Z',
      },
      {
        from: 'daniel-navarro',
        content: 'On it — extracting the runtime logic now.',
        timestamp: '2026-03-09T11:01:00.000Z',
      },
    ];

    const summary = buildSummaryMarkdown(messages, 'Clemens');

    expect(summary).toContain('**Clemens**');
    expect(summary).toContain('**daniel-navarro**');
    expect(summary).toContain('---');
    expect(summary).toContain('Please split ChatPanel into controller and view.');
  });

  it('matches the persisted version of a message even when timestamps drift', () => {
    const localMessage: ChatMessage = {
      from: 'human',
      isHuman: true,
      content: 'Please delete this after the refactor.',
      timestamp: '2026-03-09T11:15:01.001Z',
    };
    const persistedMessages: ChatMessage[] = [
      {
        ...localMessage,
        timestamp: '2026-03-09T11:15:01.187Z',
      },
      {
        from: 'daniel-navarro',
        content: 'Absolutely — cleaning it up now.',
        timestamp: '2026-03-09T11:15:03.000Z',
      },
    ];

    expect(findMatchingMessageIndex(persistedMessages, localMessage, 0)).toBe(0);
    expect(findMatchingMessage(persistedMessages, localMessage, 0)).toEqual(persistedMessages[0]);
  });

  it('uses nearby index to disambiguate duplicate content', () => {
    const target: ChatMessage = {
      from: 'daniel-navarro',
      content: 'Same content, different turn.',
      timestamp: '2026-03-09T11:20:00.000Z',
    };
    const persistedMessages: ChatMessage[] = [
      {
        ...target,
        timestamp: '2026-03-09T11:20:00.100Z',
      },
      {
        from: 'human',
        isHuman: true,
        content: 'Interleaving question',
        timestamp: '2026-03-09T11:20:01.000Z',
      },
      {
        ...target,
        timestamp: '2026-03-09T11:20:02.100Z',
      },
    ];

    expect(findMatchingMessageIndex(persistedMessages, target, 2)).toBe(2);
  });

  it('treats undefined and false optional flags as equivalent when matching', () => {
    const left: ChatMessage = {
      from: 'human',
      content: 'Optional flag normalization',
      timestamp: '2026-03-09T12:00:00.000Z',
    };
    const right: ChatMessage = {
      ...left,
      isHuman: false,
      archived: false,
    };

    expect(areMessagesEquivalent(left, right)).toBe(true);
  });
});
