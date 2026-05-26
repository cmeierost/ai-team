import { describe, expect, it } from 'vitest';
import { PreLlmIntentResolver } from './pre-llm-intents.js';
import type { IPreLlmToolSource } from './pre-llm-intents.js';

function makeContext() {
  return {
    agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo' },
  } as any;
}

function makeToolSource(tools: unknown[]): IPreLlmToolSource {
  return { getForAgent: () => tools as any };
}

describe('PreLlmIntentResolver', () => {
  it('uses toolSource.getForAgent with correct this binding', async () => {
    const scoredTool = {
      metadata: { key: 'list', group: 'tool' },
      scorePreLlmIntent: () => ({
        kind: 'tool' as const,
        toolName: 'tool_list',
        args: {},
        score: 100,
      }),
    };

    const toolSource: IPreLlmToolSource = {
      tools: [scoredTool],
      getForAgent(this: { tools: unknown[] }, _agent: unknown) {
        return this.tools as any;
      },
    } as any;

    const resolver = new PreLlmIntentResolver(toolSource);
    const intent = await resolver.resolve('what tools can you use?', makeContext());
    expect(intent).toEqual(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'tool_list',
        score: 100,
      })
    );
  });

  it('returns undefined (no crash) when context has no current agent', async () => {
    const resolver = new PreLlmIntentResolver(makeToolSource([]));
    const intent = await resolver.resolve('forward me to emily', { history: [] } as any);
    expect(intent).toBeUndefined();
  });

  it('returns an executable tool intent for score=100 matches', async () => {
    const resolver = new PreLlmIntentResolver(
      makeToolSource([
        {
          metadata: { key: 'list', group: 'tool' },
          scorePreLlmIntent: () => ({
            kind: 'tool',
            toolName: 'tool_list',
            args: {},
            score: 100,
          }),
        },
      ])
    );

    const intent = await resolver.resolve('what tools can you use?', makeContext());

    expect(intent).toEqual(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'tool_list',
        score: 100,
      })
    );
  });

  it('returns clarify_then_tool confirmation when score is >=80 and <100', async () => {
    const resolver = new PreLlmIntentResolver(
      makeToolSource([
        {
          metadata: { key: 'tree', group: 'fs' },
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
      ])
    );

    const intent = await resolver.resolve('show project structure', makeContext());

    expect(intent?.kind).toBe('clarify_then_tool');
    if (!intent || intent.kind !== 'clarify_then_tool') return;

    expect(intent.toolName).toBe('fs_tree');
    expect(intent.ask.kind).toBe('confirm');
    expect(intent.resolveArgs(true)).toEqual({ path: '.', maxDepth: 6 });
  });

  it('returns undefined when best score is below minimum action threshold', async () => {
    const resolver = new PreLlmIntentResolver(
      makeToolSource([
        {
          metadata: { key: 'list', group: 'team' },
          scorePreLlmIntent: () => ({
            kind: 'tool',
            toolName: 'team_list',
            args: {},
            score: 40,
          }),
        },
      ])
    );

    const intent = await resolver.resolve('who is on the team?', makeContext());
    expect(intent).toBeUndefined();
  });

  it('returns ordered selection when several tools score >=80', async () => {
    const resolver = new PreLlmIntentResolver(
      makeToolSource([
        {
          metadata: { key: 'list', group: 'tool' },
          scorePreLlmIntent: () => ({
            kind: 'tool',
            toolName: 'tool_list',
            args: {},
            score: 88,
            reason: 'Tool capability request',
          }),
        },
        {
          metadata: { key: 'list', group: 'team' },
          scorePreLlmIntent: () => ({
            kind: 'tool',
            toolName: 'team_list',
            args: {},
            score: 86,
            reason: 'Team roster request',
          }),
        },
      ])
    );

    const intent = await resolver.resolve('list what we have', makeContext());

    expect(intent?.kind).toBe('clarify_then_tool');
    if (!intent || intent.kind !== 'clarify_then_tool') return;

    expect(intent.ask.kind).toBe('select');
    expect(intent.resolveArgs('1')).toEqual({});
  });
});
