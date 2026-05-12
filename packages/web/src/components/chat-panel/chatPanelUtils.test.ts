import { describe, expect, it } from 'vitest';
import type { Agent, ChatMessage, SessionActivatedTool } from '../../types';
import {
  areMessagesEquivalent,
  buildSummaryMarkdown,
  extractSessionActivatedTools,
  findMatchingMessage,
  findMatchingMessageIndex,
  getPersistedToolStatus,
  normalizeChatErrorMessage,
  reconstructActivatedToolsFromMessages,
  resolveRouteAgent,
  resolveNavigateAgent,
  resolveRuntimeToolEventMessage,
  shouldRenderSlashToolMessage,
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

  it('classifies persisted execution failures as error phase', () => {
    const status = getPersistedToolStatus({
      tool: 'http_fetch',
      result: {
        status: 'error',
        message: 'fetch failed',
        denial: {
          kind: 'execution-failed',
          reasonCode: 'tool_execution_failed',
          message: 'fetch failed',
        },
      },
      resultLlm: 'fetch failed',
    });

    expect(status.phase).toBe('error');
    expect(status.outcome).toBe('error');
    expect(status.message).toBe('fetch failed');
  });

  it('reconstructs tool events from persisted failed tool_calls', () => {
    const events = reconstructActivatedToolsFromMessages([
      {
        from: 'agent-a',
        isHuman: false,
        timestamp: '2026-03-09T10:00:00.000Z',
        content: '[tool:http_fetch] fetch failed',
        tool_calls: [
          {
            tool: 'http_fetch',
            params: { url: 'https://example.com' },
            result: {
              status: 'error',
              message: 'fetch failed',
              denial: {
                kind: 'execution-failed',
                reasonCode: 'tool_execution_failed',
                message: 'fetch failed',
              },
            },
            resultLlm: 'fetch failed',
          },
        ],
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].toolPhase).toBe('error');
    expect(events[0].message).toBe('fetch failed');
    expect(events[0].toolResult?.outcome).toBe('error');
    expect(events[0].toolResult?.resultLlm).toBe('fetch failed');
  });

  it('resolves forward handoff targets from handoff messages', () => {
    const handoffMessage: ChatMessage = {
      from: 'daniel-navarro',
      to: 'clara-bishop',
      content: 'HANDOFF: clara-bishop | please continue the QA pass',
      timestamp: '2026-03-09T10:10:00.000Z',
      handoffToSessionId: 'session-clara-1',
    };

    expect(
      resolveNavigateAgent(handoffMessage, agents, 'daniel-navarro', 'daniel-navarro')
    ).toEqual({
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
      'The request could not be completed. Please try again.'
    );
    expect(normalizeChatErrorMessage('Something else went wrong')).toBe(
      'Something else went wrong'
    );
  });

  it('resolves route agent query by exact id', () => {
    expect(resolveRouteAgent(agents, 'daniel-navarro')?.id).toBe('daniel-navarro');
  });

  it('resolves route agent query by role', () => {
    expect(resolveRouteAgent(agents, 'frontend lead')?.id).toBe('daniel-navarro');
  });

  it('resolves route agent query by display name and name slug', () => {
    expect(resolveRouteAgent(agents, 'Clara Bishop')?.id).toBe('clara-bishop');
    expect(resolveRouteAgent(agents, 'clara-bishop')?.id).toBe('clara-bishop');
  });

  it('returns null for ambiguous route query matches', () => {
    const duplicateRoleAgents: Agent[] = [
      { id: 'a', name: 'Alex One', role: 'Engineer' },
      { id: 'b', name: 'Alex Two', role: 'Engineer' },
    ];

    expect(resolveRouteAgent(duplicateRoleAgents, 'engineer')).toBeNull();
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

  it('resolves slash command tool event messages via command-key handlers', () => {
    const message = resolveRuntimeToolEventMessage({
      toolName: 'slash:who',
      message: 'fallback',
      toolResult: {
        toolName: 'slash:who',
        outcome: 'result',
        commandResponse: {
          status: 'ok',
          message: 'resolved message',
          data: 'Daniel Navarro · Frontend Lead',
        },
      },
    });

    expect(message).toBe('Daniel Navarro · Frontend Lead');
  });

  it('falls back to runtime message when slash payload is not a command response', () => {
    const message = resolveRuntimeToolEventMessage({
      toolName: 'slash:who',
      message: 'fallback',
      toolResult: {
        toolName: 'slash:who',
        outcome: 'result',
        commandResponse: { anything: true } as never,
      },
    });

    expect(message).toBe('fallback');
  });

  it('renders slash tool message only for terminal phases with text', () => {
    expect(
      shouldRenderSlashToolMessage({
        toolName: 'slash:help',
        toolPhase: 'result',
        message: 'Available commands',
      })
    ).toBe(true);

    expect(
      shouldRenderSlashToolMessage({
        toolName: 'slash:help',
        toolPhase: 'start',
        message: 'Available commands',
      })
    ).toBe(false);

    expect(
      shouldRenderSlashToolMessage({
        toolName: 'slash:help',
        toolPhase: 'result',
        message: '   ',
      })
    ).toBe(false);

    expect(
      shouldRenderSlashToolMessage({
        toolName: 'read_file',
        toolPhase: 'result',
        message: 'done',
      })
    ).toBe(false);
  });
});
