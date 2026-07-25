import { describe, expect, it, vi } from 'vitest';
import { createInitWorkflowDefinition } from './init-workflow.js';
import { evaluateWorkflowCondition } from '../../workflow/workflow-param-resolver.js';

describe('init workflow guards', () => {
  it('skips destructive cleanup by default', () => {
    const definition = createInitWorkflowDefinition(
      {
        setup: { execute: vi.fn() },
        testConnection: { execute: vi.fn() },
        onboard: { execute: vi.fn() },
      } as any,
      { log: vi.fn() } as any
    );
    const clearStep = definition.steps.find((step) => step.id === 'clear-existing') as {
      skipWhen: string;
    };

    expect(
      evaluateWorkflowCondition(clearStep.skipWhen, {
        shouldSkip: false,
        shouldClear: false,
      })
    ).toBe(true);
    expect(
      evaluateWorkflowCondition(clearStep.skipWhen, {
        shouldSkip: false,
        shouldClear: true,
      })
    ).toBe(false);
  });
});
