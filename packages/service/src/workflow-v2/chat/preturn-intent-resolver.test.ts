import { describe, expect, it } from 'vitest';
import type { Agent, ICommand, ExecutionContext } from '@ai-team/core';
import { WorkflowV2PreTurnIntentResolver } from './preturn-intent-resolver.js';

class TestToolSource {
  constructor(private readonly tools: ICommand[]) {}

  getForAgent(_agent: Agent): ICommand[] {
    return this.tools;
  }
}

class AutoSelectTool implements ICommand {
  readonly metadata = {
    key: 'list',
    group: 'workflow',
    availableIn: { tool: true },
    description: 'list workflows',
  } as any;

  async execute(): Promise<unknown> {
    return undefined;
  }

  async scorePreLlmIntent() {
    return {
      kind: 'tool' as const,
      toolName: 'workflow_list',
      args: {},
      score: 100,
      reason: 'deterministic match',
    };
  }
}

class ConfirmTool implements ICommand {
  readonly metadata = {
    key: 'switch',
    group: 'workflow',
    availableIn: { tool: true },
    description: 'switch workflow',
  } as any;

  async execute(): Promise<unknown> {
    return undefined;
  }

  async scorePreLlmIntent() {
    return {
      kind: 'tool' as const,
      toolName: 'workflow_switch',
      args: { workflowId: 'planning' },
      score: 85,
      reason: 'high confidence match',
    };
  }
}

describe('WorkflowV2PreTurnIntentResolver', () => {
  it('auto-selects deterministic score 100 candidate', async () => {
    const resolver = new WorkflowV2PreTurnIntentResolver(
      new TestToolSource([new AutoSelectTool() as unknown as ICommand])
    );

    const result = await resolver.resolveAsync('list workflows', {
      agent: { id: 'a1' },
      history: [],
    } as unknown as ExecutionContext);

    expect(result).toEqual({
      kind: 'tool',
      toolName: 'workflow_list',
      args: {},
      score: 100,
      reason: 'deterministic match',
    });
  });

  it('returns confirm intent when candidate exceeds threshold but is not auto-select', async () => {
    const resolver = new WorkflowV2PreTurnIntentResolver(
      new TestToolSource([new ConfirmTool() as unknown as ICommand])
    );

    const result = await resolver.resolveAsync('switch workflow', {
      agent: { id: 'a1' },
      history: [],
    } as unknown as ExecutionContext);

    expect(result?.kind).toBe('clarify_then_tool');
    expect(result?.toolName).toBe('workflow_switch');
    expect(result?.score).toBe(85);
    expect(result?.ask?.kind).toBe('confirm');
  });

  it('returns undefined when no candidate reaches thresholds and no clarification is provided', async () => {
    const lowScoreTool: ICommand = {
      metadata: {
        key: 'low',
        group: 'workflow',
        availableIn: { tool: true },
        description: 'low score',
      } as any,
      execute: async () => undefined,
      scorePreLlmIntent: async () => ({
        kind: 'tool' as const,
        toolName: 'workflow_low',
        args: {},
        score: 20,
      }),
    } as unknown as ICommand;

    const resolver = new WorkflowV2PreTurnIntentResolver(new TestToolSource([lowScoreTool]));

    const result = await resolver.resolveAsync('maybe workflow', {
      agent: { id: 'a1' },
      history: [],
    } as unknown as ExecutionContext);

    expect(result).toBeUndefined();
  });
});
