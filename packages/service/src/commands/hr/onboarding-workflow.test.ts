import { describe, expect, it, vi } from 'vitest';
import {
  createOnboardingWorkflowDefinition,
  OnboardingWorkflowCommand,
} from './onboarding-workflow.js';

describe('OnboardingWorkflowCommand', () => {
  it('hands off after creating the CEO instead of running a simulated chat phase', () => {
    const definition = createOnboardingWorkflowDefinition({ dispatch: vi.fn() } as any);

    expect(definition.steps.map((step) => step.id)).toEqual([
      'bootstrap',
      'prepare_context',
      'ceo_names',
      'pick_ceo',
      'hire_ceo',
      'ceo_permissions',
    ]);
    expect(definition.steps.map((step) => step.id)).not.toContain('business_chat');
  });

  it('returns an error when the workflow runner aborts', async () => {
    const command = new OnboardingWorkflowCommand(
      { dispatch: vi.fn() } as any,
      {
        create: () => ({
          run: vi.fn(async () => ({
            state: { workspaceRoot: 'C:/workspace' },
            aborted: true,
            abortedError: "step 'prepare_context' failed: missing template",
          })),
        }),
      } as any
    );

    await expect(
      command.execute({ workspaceRoot: 'C:/workspace' }, {
        history: [],
        invocationSurface: 'cli',
      } as any)
    ).resolves.toEqual({
      status: 'error',
      message: "step 'prepare_context' failed: missing template",
    });
  });
});
