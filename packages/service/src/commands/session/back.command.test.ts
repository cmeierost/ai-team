import { describe, expect, it, vi } from 'vitest';
import { BackChatCommand } from './back.command.js';

describe('BackChatCommand', () => {
  it('routes /back to the active durable workflow child', async () => {
    const workflowInteractions = {
      resolveActiveInteraction: vi.fn(async () => ({
        runId: 'onboarding:1',
        sessionId: 'ceo-session',
        actorPath: 'workflowChatInvocation_business',
        cursor: 'onboarding:1:workflowChatInvocation_business',
      })),
      dispatch: vi.fn(async () => null),
    };
    const command = new BackChatCommand(workflowInteractions as any);

    const result = await command.execute({}, { history: [], sessionId: 'ceo-session' } as any);

    expect(workflowInteractions.dispatch).toHaveBeenCalledWith(
      'ceo-session',
      { type: 'BACK_ATTEMPT' },
      'onboarding:1:workflowChatInvocation_business'
    );
    expect(result).toEqual({
      status: 'ok',
      message: 'Workflow back transition is being processed.',
      data: {
        workflowRunId: 'onboarding:1',
        interactionCursor: 'onboarding:1:workflowChatInvocation_business',
      },
    });
  });

  it('re-resolves and retries /back once when the interaction cursor changed concurrently', async () => {
    const workflowInteractions = {
      resolveActiveInteraction: vi
        .fn()
        .mockResolvedValueOnce({
          runId: 'onboarding:1',
          sessionId: 'ceo-session',
          actorPath: 'workflowChatInvocation_business_v1',
          cursor: 'onboarding:1:workflowChatInvocation_business_v1',
        })
        .mockResolvedValueOnce({
          runId: 'onboarding:1',
          sessionId: 'ceo-session',
          actorPath: 'workflowChatInvocation_business_v2',
          cursor: 'onboarding:1:workflowChatInvocation_business_v2',
        }),
      dispatch: vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "Workflow interaction cursor mismatch for session 'ceo-session': expected 'onboarding:1:workflowChatInvocation_business_v1', current 'onboarding:1:workflowChatInvocation_business_v2'."
          )
        )
        .mockResolvedValueOnce(null),
    };
    const command = new BackChatCommand(workflowInteractions as any);

    const result = await command.execute({}, { history: [], sessionId: 'ceo-session' } as any);

    expect(workflowInteractions.dispatch).toHaveBeenNthCalledWith(
      1,
      'ceo-session',
      { type: 'BACK_ATTEMPT' },
      'onboarding:1:workflowChatInvocation_business_v1'
    );
    expect(workflowInteractions.dispatch).toHaveBeenNthCalledWith(
      2,
      'ceo-session',
      { type: 'BACK_ATTEMPT' },
      'onboarding:1:workflowChatInvocation_business_v2'
    );
    expect(result).toEqual({
      status: 'ok',
      message: 'Workflow back transition is being processed.',
      data: {
        workflowRunId: 'onboarding:1',
        interactionCursor: 'onboarding:1:workflowChatInvocation_business_v2',
      },
    });
  });

  it('fails clearly when no active interaction exists', async () => {
    const workflowInteractions = {
      resolveActiveInteraction: vi.fn(async () => null),
      dispatch: vi.fn(async () => null),
    };
    const command = new BackChatCommand(workflowInteractions as any);

    const result = await command.execute({}, { history: [], sessionId: 'ceo-session' } as any);

    expect(result).toEqual({
      status: 'error',
      message: 'No active workflow interaction to go back from.',
    });
    expect(workflowInteractions.dispatch).not.toHaveBeenCalled();
  });
});

