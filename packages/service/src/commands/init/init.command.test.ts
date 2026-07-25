import { describe, expect, it, vi } from 'vitest';
import { InitICommand } from './init.command.js';
import { EmitService } from '../../interaction/emit-service.js';

describe('InitICommand', () => {
  it('does not treat a truthy non-boolean Commander force member as --force', async () => {
    let capturedState: any;
    const command = new InitICommand(
      'C:/workspace',
      new EmitService(() => {}),
      {} as any,
      {} as any,
      {} as any,
      {
        create: () => ({
          run: vi.fn(async (_definition: any, initialState: any) => {
            capturedState = initialState;
            return { state: initialState, aborted: false };
          }),
        }),
      } as any
    );

    await command.execute({ options: { force: vi.fn() } as any }, { history: [] });

    expect(capturedState.options.force).toBeUndefined();
  });

  it('runs setup, verifies the refreshed connection, and continues into onboarding', async () => {
    const setup = { execute: vi.fn(async () => undefined) };
    const testConnection = { execute: vi.fn(async () => undefined) };
    const onboard = {
      executeOnboarding: vi.fn(async () => ({
        ceoAgentId: 'elena-rodriguez',
        ceoName: 'Elena Rodriguez',
        businessSystemPrompt: 'Define the business with the developer.',
        businessOpeningMessage: 'Elena: Let us define the business.',
      })),
    };
    const run = vi.fn(async (definition: any, initialState: any, options: any) => {
      let state = initialState;
      for (const step of definition.steps) {
        if (step.id === 'clear-existing') continue;
        state = await step.execute(state, options.executionContext);
      }
      return { state, aborted: false };
    });
    const workflowRunnerFactory = {
      create: () => ({ run }),
    };

    const command = new InitICommand(
      'C:/workspace',
      new EmitService(() => {}),
      onboard as any,
      setup as any,
      testConnection as any,
      workflowRunnerFactory as any
    );

    await expect(command.execute({ options: {} }, { history: [] })).resolves.toEqual({
      status: 'ok',
      data: {
        chat: {
          agentId: 'elena-rodriguez',
          createNewSession: true,
          workflowMode: true,
          workflowSystemPrompt: 'Define the business with the developer.',
          workflowExitWords: ['done', 'clear', 'finished'],
          workflowToolAllowlist: [
            'com_ask',
            'hr_name_suggestions',
            'hr_hire_agent',
            'access_set_permissions',
            'com_handoff',
          ],
          introductionText: 'Elena: Let us define the business.',
          suppressAutoIntroduction: true,
        },
      },
    });

    expect(setup.execute).toHaveBeenCalled();
    expect(testConnection.execute).toHaveBeenCalled();
    expect(onboard.executeOnboarding).toHaveBeenCalled();
    expect(testConnection.execute.mock.invocationCallOrder[0]).toBeLessThan(
      onboard.executeOnboarding.mock.invocationCallOrder[0]
    );
  });

  it('returns an error when the workflow runner aborts a failed step', async () => {
    const command = new InitICommand(
      'C:/workspace',
      new EmitService(() => {}),
      {} as any,
      {} as any,
      {} as any,
      {
        create: () => ({
          run: vi.fn(async () => ({
            state: {},
            aborted: true,
            abortedError: 'test-llm-connection failed: no effective configuration',
          })),
        }),
      } as any
    );

    await expect(command.execute({ options: {} }, { history: [] })).resolves.toEqual({
      status: 'error',
      message: 'test-llm-connection failed: no effective configuration',
    });
  });
});
