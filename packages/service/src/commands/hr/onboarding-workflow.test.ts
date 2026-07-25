import { describe, expect, it, vi } from 'vitest';
import { CORE_SERVICE_TOKENS, type IBackendLogService, type IServiceContainer } from '@ai-team/core';
import {
  createOnboardingWorkflowDefinition,
  OnboardingWorkflowCommand,
} from './onboarding-workflow.js';
import { WorkflowRunner } from '../../workflow/xstate-workflow-runner.js';

const noOpBackendLogService: IBackendLogService = {
  write: () => {},
};

function createRunner(): WorkflowRunner {
  const container = {
    resolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.ToolManager) return { get: () => undefined };
      if (token === CORE_SERVICE_TOKENS.BackendLogService) return noOpBackendLogService;
      throw new Error(`Unexpected token: ${String(token)}`);
    },
    tryResolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.BackendLogService) return noOpBackendLogService;
      if (token === CORE_SERVICE_TOKENS.ToolManager) return { get: () => undefined };
      return undefined;
    },
    has: () => false,
    child() {
      return this;
    },
    register() {
      return this;
    },
    registerSingleton() {
      return this;
    },
    registerTransient() {
      return this;
    },
    registerScoped() {
      return this;
    },
    registerInstance() {
      return this;
    },
  } as unknown as IServiceContainer;
  return new WorkflowRunner(container, noOpBackendLogService);
}

async function waitForCondition(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('OnboardingWorkflowCommand', () => {
  it('invokes CEO business-definition chat after creating the CEO', () => {
    const definition = createOnboardingWorkflowDefinition({ dispatch: vi.fn() } as any);

    expect(definition.steps.map((step) => step.id)).toEqual([
      'bootstrap',
      'prepare_context',
      'ceo_names',
      'pick_ceo',
      'hire_ceo',
      'ceo_permissions',
      'business_definition',
      'hr_names',
      'pick_hr',
      'hire_hr',
      'hr_permissions',
      'hr_hiring',
    ]);
    const businessStep = definition.steps.find((step) => step.id === 'business_definition') as any;
    expect(businessStep.kind).toBe('chat');
    expect(businessStep.agentId).toBe('{{hire_ceo.agentId}}');
    expect(businessStep.done.command).toBe('init-check_business_definition');
    expect(businessStep.finalize.command).toBe('init-finalize_business_definition');
    expect(businessStep.chat.toolPolicy.allow).toContain('init-approve_business_definition');

    const hrNameStep = definition.steps.find((step) => step.id === 'hr_names') as any;
    const pickHrStep = definition.steps.find((step) => step.id === 'pick_hr') as any;
    const hireHrStep = definition.steps.find((step) => step.id === 'hire_hr') as any;
    const hrPermissionsStep = definition.steps.find((step) => step.id === 'hr_permissions') as any;
    const hrHiringStep = definition.steps.find((step) => step.id === 'hr_hiring') as any;
    expect(hrNameStep).toBeDefined();
    expect(pickHrStep).toBeDefined();
    expect(hireHrStep).toBeDefined();
    expect(hrPermissionsStep).toBeDefined();
    expect(hrHiringStep.kind).toBe('chat');
    expect(hrHiringStep.agentId).toBe('{{hire_hr.agentId}}');
    expect(hrHiringStep.done.command).toBe('init-check_hiring_completion');
    expect(hrHiringStep.finalize.command).toBe('init-finalize_hiring_completion');
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

  it('integrates return attempts, shared question commands, hiring, permissions, and child routing', async () => {
    const dispatch = vi.fn(async (key: string, payload: any) => {
      switch (key) {
        case 'init-bootstrap_files':
          return { status: 'ok', data: { workspaceRoot: payload.workspaceRoot } };
        case 'init-prepare_onboarding':
          return {
            status: 'ok',
            data: {
              businessSystemPrompt: 'Business prompt',
              businessIntroLines: ['Hello {{ceoName}}'],
              planningSystemPrompt: 'Planning prompt',
              ceoIntroduction: 'CEO intro',
              hrIntroduction: 'HR intro for {{pick_hr.answer}}',
              ceoPersonalityProfile: ['strategic'],
              hrPersonalityProfile: ['people-first'],
            },
          };
        case 'hr-name_suggestions':
          return {
            status: 'ok',
            data: {
              suggestions:
                payload.roleLabel === 'CEO'
                  ? ['Avery Stone', 'Jordan Vale']
                  : ['Dana Cross', 'Sam Hale'],
            },
          };
        case 'com-ask':
          return {
            status: 'ok',
            data: {
              type: 'select',
              kind: 'select',
              answer:
                payload.message === 'Which candidate should we hire as CEO?'
                  ? 'Avery Stone'
                  : 'Dana Cross',
            },
          };
        case 'hr-hire_agent':
          return {
            status: 'ok',
            data: {
              agentId: payload.role === 'ceo' ? 'agent-ceo' : 'agent-hr',
              name: payload.name,
              role: payload.role,
            },
          };
        case 'access-set_permissions':
          return {
            status: 'ok',
            data: {
              agentId: payload.agentId,
            },
          };
        default:
          return { status: 'error', message: `Unexpected command key ${key}` };
      }
    });
    const checkBusiness = vi.fn(async () => ({ done: true }));
    const finalizeBusiness = vi.fn(async () => ({
      summary: {
        problemStatement: 'Problem',
        primaryTargetUsers: 'Users',
        valueProposition: 'Value',
        successCriteria: 'Criteria',
        constraints: 'Constraints',
        nonGoals: 'Non-goals',
      },
    }));
    const checkHiring = vi.fn(async () => ({ done: true }));
    const finalizeHiring = vi.fn(async () => ({ completed: true }));
    const runner = createRunner();

    const handle = await runner.start(
      createOnboardingWorkflowDefinition({ dispatch }),
      { workspaceRoot: 'C:/workspace' },
      {
        executionContext: { history: [], sessionId: 'onboarding-session' },
        commands: {
          'init-check_business_definition': { execute: checkBusiness },
          'init-finalize_business_definition': { execute: finalizeBusiness },
          'init-check_hiring_completion': { execute: checkHiring },
          'init-finalize_hiring_completion': { execute: finalizeHiring },
        },
      }
    );

    await waitForCondition(
      () => handle.getSnapshotView().interaction?.actorPath === 'workflowChatInvocation_business_definition'
    );
    expect(handle.getSnapshotView().interaction).toMatchObject({
      sessionId: 'onboarding-session',
      actorPath: 'workflowChatInvocation_business_definition',
    });
    await handle.dispatch({ type: 'RETURN_ATTEMPT' });

    await waitForCondition(
      () => handle.getSnapshotView().interaction?.actorPath === 'workflowChatInvocation_hr_hiring'
    );
    expect(handle.getSnapshotView().interaction).toMatchObject({
      sessionId: 'onboarding-session',
      actorPath: 'workflowChatInvocation_hr_hiring',
    });
    await handle.dispatch({ type: 'RETURN_ATTEMPT' });
    const result = await handle.waitForDone();

    expect(result.aborted).toBe(false);
    expect(result.state.hire_ceo).toMatchObject({ agentId: 'agent-ceo', name: 'Avery Stone' });
    expect(result.state.hire_hr).toMatchObject({ agentId: 'agent-hr', name: 'Dana Cross' });
    expect(result.state.ceo_permissions).toMatchObject({ agentId: 'agent-ceo' });
    expect(result.state.hr_permissions).toMatchObject({ agentId: 'agent-hr' });
    expect(dispatch).toHaveBeenCalledWith(
      'com-ask',
      expect.objectContaining({ message: 'Which candidate should we hire as CEO?' }),
      expect.any(Object)
    );
    expect(dispatch).toHaveBeenCalledWith(
      'com-ask',
      expect.objectContaining({ message: 'Which candidate should we hire as HR Director?' }),
      expect.any(Object)
    );
    expect(dispatch).toHaveBeenCalledWith(
      'access-set_permissions',
      expect.objectContaining({ agentId: 'agent-ceo' }),
      expect.any(Object)
    );
    expect(dispatch).toHaveBeenCalledWith(
      'access-set_permissions',
      expect.objectContaining({ agentId: 'agent-hr' }),
      expect.any(Object)
    );
    expect(checkBusiness).toHaveBeenCalledTimes(1);
    expect(finalizeBusiness).toHaveBeenCalledTimes(1);
    expect(checkHiring).toHaveBeenCalledTimes(1);
    expect(finalizeHiring).toHaveBeenCalledTimes(1);
  });
});
