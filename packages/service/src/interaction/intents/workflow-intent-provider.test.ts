import { describe, expect, it } from 'vitest';
import { WorkflowIntentProvider } from './workflow-intent-provider.js';

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    hooks: {
      workflowState: {
        workflowId: 'implementation',
        continuationToken: 'cont-1',
        answers: {},
      },
    },
    ...overrides,
  } as any;
}

describe('WorkflowIntentProvider', () => {
  it('returns no candidates when the message does not ask to switch workflow', async () => {
    const provider = new WorkflowIntentProvider();

    const candidates = await provider.resolveCandidates('help me with this bug', makeContext());
    expect(candidates).toEqual([]);
  });

  it('returns a select com_ask candidate for workflow-switch messages', async () => {
    const provider = new WorkflowIntentProvider();

    const candidates = await provider.resolveCandidates('switch workflow please', makeContext());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'com_ask',
        score: 93,
        source: 'workflow-intent-provider',
        args: expect.objectContaining({
          kind: 'select',
          workflow: expect.objectContaining({
            workflowId: 'implementation',
            continuationToken: 'cont-1',
            questionId: 'pre-llm-workflow-switch',
          }),
        }),
      })
    );
  });

  it('returns a checklist com_ask candidate when message hints multi-select', async () => {
    const provider = new WorkflowIntentProvider();

    const candidates = await provider.resolveCandidates(
      'switch workflow to multiple options and compare',
      makeContext()
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.kind).toBe('tool');
    const candidate = candidates[0];
    if (!candidate || candidate.kind !== 'tool') return;

    expect(candidate.args).toEqual(
      expect.objectContaining({
        kind: 'checklist',
        minSelections: 1,
        maxSelections: 3,
      })
    );
  });
});
