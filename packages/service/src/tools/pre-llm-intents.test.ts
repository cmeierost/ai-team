import { describe, expect, it } from 'vitest';
import { resolvePreLlmIntent } from './pre-llm-intents.js';

function makeContext(tools: unknown[]) {
  return {
    agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo' },
    toolManager: {
      getForAgent: () => tools,
    },
  } as any;
}

describe('resolvePreLlmIntent', () => {
  it('uses toolManager.getForAgent with correct this binding', async () => {
    const scoredTool = {
      key: 'list',
      group: 'tool',
      scorePreLlmIntent: () => ({
        kind: 'tool' as const,
        toolName: 'tool_list',
        args: {},
        score: 100,
      }),
    };

    const toolManager = {
      tools: [scoredTool],
      getForAgent(this: { tools: unknown[] }, _agent: unknown) {
        return this.tools as any;
      },
    };

    const ctx = {
      agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo' },
      toolManager,
    } as any;

    const intent = await resolvePreLlmIntent('what tools can you use?', ctx);
    expect(intent).toEqual(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'tool_list',
        score: 100,
      })
    );
  });

  it('returns undefined (no crash) when context has no current agent', async () => {
    const ctx = {
      toolManager: {
        getForAgent: () => {
          throw new Error('should not be called without ctx.agent');
        },
      },
    } as any;

    const intent = await resolvePreLlmIntent('forward me to emily', ctx);
    expect(intent).toBeUndefined();
  });

  it('returns an executable tool intent for score=100 matches', async () => {
    const ctx = makeContext([
      {
        key: 'list',
        group: 'tool',
        scorePreLlmIntent: () => ({
          kind: 'tool',
          toolName: 'tool_list',
          args: {},
          score: 100,
        }),
      },
    ]);

    const intent = await resolvePreLlmIntent('what tools can you use?', ctx);

    expect(intent).toEqual(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'tool_list',
        score: 100,
      })
    );
  });

  it('returns clarify_then_tool confirmation when score is >=80 and <100', async () => {
    const ctx = makeContext([
      {
        key: 'tree',
        group: 'fs',
        scorePreLlmIntent: () => ({
          kind: 'tool',
          toolName: 'fs_tree',
          args: { path: '.', maxDepth: 6 },
          score: 82,
          clarification: {
            ask: {
              kind: 'select',
              message: 'How deep should I scan?',
              choices: [
                { name: 'Quick', value: 'quick' },
                { name: 'Deep', value: 'deep' },
              ],
              defaultText: 'quick',
            },
            resolveArgs(answer: unknown) {
              return { path: '.', maxDepth: answer === 'deep' ? 10 : 3 };
            },
          },
        }),
      },
    ]);

    const intent = await resolvePreLlmIntent('show project structure', ctx);

    expect(intent?.kind).toBe('clarify_then_tool');
    if (!intent || intent.kind !== 'clarify_then_tool') return;

    expect(intent.toolName).toBe('fs_tree');
    expect(intent.ask.kind).toBe('confirm');
    expect(intent.resolveArgs(true)).toEqual({ path: '.', maxDepth: 6 });
  });

  it('returns undefined when best score is below minimum action threshold', async () => {
    const ctx = makeContext([
      {
        key: 'list',
        group: 'team',
        scorePreLlmIntent: () => ({
          kind: 'tool',
          toolName: 'team_list',
          args: {},
          score: 40,
        }),
      },
    ]);

    const intent = await resolvePreLlmIntent('who is on the team?', ctx);
    expect(intent).toBeUndefined();
  });

  it('returns ordered selection when several tools score >=80', async () => {
    const ctx = makeContext([
      {
        key: 'list',
        group: 'tool',
        scorePreLlmIntent: () => ({
          kind: 'tool',
          toolName: 'tool_list',
          args: {},
          score: 88,
          reason: 'Tool capability request',
        }),
      },
      {
        key: 'list',
        group: 'team',
        scorePreLlmIntent: () => ({
          kind: 'tool',
          toolName: 'team_list',
          args: {},
          score: 86,
          reason: 'Team roster request',
        }),
      },
    ]);

    const intent = await resolvePreLlmIntent('list what we have', ctx);

    expect(intent?.kind).toBe('clarify_then_tool');
    if (!intent || intent.kind !== 'clarify_then_tool') return;

    expect(intent.ask.kind).toBe('select');
    expect(intent.resolveArgs('1')).toEqual({});
  });
});
