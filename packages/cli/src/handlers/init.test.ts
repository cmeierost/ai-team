import { describe, expect, it, vi } from 'vitest';
import type { ICliCommandClient } from '../cli-command-client.js';
import { renderInit } from './init.js';

describe('init command', () => {
  it('dispatches the init workflow with explicit nested options', async () => {
    const streamInteraction = vi.fn(async function* () {
      yield {
        command: 'setup-init',
        kind: 'done',
        timestamp: new Date().toISOString(),
      } as any;
    });

    await renderInit(
      {
        getCommands: () => [],
        streamInteraction,
      } as unknown as ICliCommandClient,
      { force: false }
    );

    expect(streamInteraction).toHaveBeenCalledWith(
      {
        command: 'setup-init',
        payload: { options: { force: false } },
      },
      {
        invocationSurface: 'cli',
        calledByHuman: true,
      }
    );
  });

  it('surfaces an error command result', async () => {
    const streamInteraction = vi.fn(async function* () {
      yield {
        command: 'setup-init',
        kind: 'result',
        timestamp: new Date().toISOString(),
        data: { status: 'error', message: 'Onboarding failed' },
      } as any;
    });

    await expect(
      renderInit(
        {
          getCommands: () => [],
          streamInteraction,
        } as unknown as ICliCommandClient,
        {}
      )
    ).rejects.toThrow('Onboarding failed');
  });

  it('returns the CEO chat handoff from the init result', async () => {
    const streamInteraction = vi.fn(async function* () {
      yield {
        command: 'setup-init',
        kind: 'result',
        timestamp: new Date().toISOString(),
        data: {
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
        },
      } as any;
    });

    await expect(
      renderInit(
        {
          getCommands: () => [],
          streamInteraction,
        } as unknown as ICliCommandClient,
        {}
      )
    ).resolves.toEqual({
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
    });
  });
});
