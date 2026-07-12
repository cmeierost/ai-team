import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@ai-team/core';
import { WorkflowV2AbortError } from './types.js';
import { WorkflowV2Runner } from './runner.js';

describe('WorkflowV2Runner', () => {
  it('executes steps in order and returns completed step ids', async () => {
    const runner = new WorkflowV2Runner({ createInstanceId: () => 'instance-1' });

    const result = await runner.run(
      {
        id: 'chat-runtime-v2',
        steps: [
          {
            id: 'first',
            async execute(state: { value: number }, ctx: ExecutionContext) {
              expect(ctx.workflowId).toBe('chat-runtime-v2');
              expect(ctx.workflowInstanceId).toBe('chat-runtime-v2:instance-1');
              expect(ctx.stepId).toBe('first');
              return { value: state.value + 1 };
            },
          },
          {
            id: 'second',
            async execute(state: { value: number }) {
              return { value: state.value + 2 };
            },
          },
        ],
      },
      { value: 0 }
    );

    expect(result).toEqual({
      state: { value: 3 },
      aborted: false,
      completedStepIds: ['first', 'second'],
      skippedStepIds: [],
    });
  });

  it('marks step as skipped when shouldRun returns false', async () => {
    const runner = new WorkflowV2Runner({ createInstanceId: () => 'instance-2' });

    const result = await runner.run(
      {
        id: 'chat-runtime-v2',
        steps: [
          {
            id: 'skipped-step',
            shouldRun: () => false,
            async execute() {
              throw new Error('step should not run');
            },
          },
          {
            id: 'next-step',
            async execute(state: { value: number }) {
              return { value: state.value + 1 };
            },
          },
        ],
      },
      { value: 0 }
    );

    expect(result.aborted).toBe(false);
    expect(result.completedStepIds).toEqual(['next-step']);
    expect(result.skippedStepIds).toEqual(['skipped-step']);
    expect(result.state).toEqual({ value: 1 });
  });

  it('returns aborted true when a step throws WorkflowV2AbortError', async () => {
    const runner = new WorkflowV2Runner({ createInstanceId: () => 'instance-3' });

    const result = await runner.run(
      {
        id: 'chat-runtime-v2',
        steps: [
          {
            id: 'first',
            async execute(state: { value: number }) {
              return { value: state.value + 1 };
            },
          },
          {
            id: 'abort-here',
            async execute() {
              throw new WorkflowV2AbortError('stop now');
            },
          },
          {
            id: 'never-runs',
            async execute(state: { value: number }) {
              return { value: state.value + 100 };
            },
          },
        ],
      },
      { value: 0 }
    );

    expect(result).toEqual({
      state: { value: 1 },
      aborted: true,
      completedStepIds: ['first'],
      skippedStepIds: [],
    });
  });

  it('returns aborted true when signal is already aborted', async () => {
    const runner = new WorkflowV2Runner({ createInstanceId: () => 'instance-4' });
    const controller = new AbortController();
    controller.abort();

    const result = await runner.run(
      {
        id: 'chat-runtime-v2',
        steps: [
          {
            id: 'never-runs',
            async execute(state: { value: number }) {
              return { value: state.value + 1 };
            },
          },
        ],
      },
      { value: 0 },
      { signal: controller.signal }
    );

    expect(result).toEqual({
      state: { value: 0 },
      aborted: true,
      completedStepIds: [],
      skippedStepIds: [],
    });
  });
});
