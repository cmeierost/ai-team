import { describe, expect, it, vi } from 'vitest';
import { CancelChatCommand } from './cancel.command.js';

describe('CancelChatCommand', () => {
  it('requires explicit confirmation before cancelling an active workflow run', async () => {
    const workflowInteractions = {
      resolveActiveRun: vi.fn(async () => ({ id: 'onboarding:1' })),
    };
    const cancel = vi.fn(async () => undefined);
    const workflowActorHost = {
      getLiveRun: vi.fn(() => ({ cancel })),
    };
    const command = new CancelChatCommand(workflowInteractions as any, workflowActorHost as any);

    const result = await command.execute({}, { history: [], sessionId: 'ceo-session' } as any);

    expect(result).toEqual({
      status: 'ok',
      message: "Cancellation requires confirmation. Re-run '/cancel confirm' to cancel this workflow.",
      data: {
        outcome: 'confirmation_required',
        cancelled: false,
        workflowRunId: 'onboarding:1',
        sessionId: 'ceo-session',
      },
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels the active workflow run when /cancel confirm is issued', async () => {
    const workflowInteractions = {
      resolveActiveRun: vi.fn(async () => ({ id: 'onboarding:1' })),
    };
    const cancel = vi.fn(async () => undefined);
    const workflowActorHost = {
      getLiveRun: vi.fn(() => ({ cancel })),
    };
    const command = new CancelChatCommand(workflowInteractions as any, workflowActorHost as any);

    const result = await command.execute(
      { confirmation: 'confirm' },
      { history: [], sessionId: 'ceo-session' } as any
    );

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'ok',
      message: 'Workflow cancellation requested.',
      data: {
        outcome: 'cancelled',
        cancelled: true,
        workflowRunId: 'onboarding:1',
        sessionId: 'ceo-session',
      },
    });
  });

  it('returns a structured no-op when there is no active workflow run', async () => {
    const workflowInteractions = {
      resolveActiveRun: vi.fn(async () => null),
    };
    const workflowActorHost = {
      getLiveRun: vi.fn(),
    };
    const command = new CancelChatCommand(workflowInteractions as any, workflowActorHost as any);

    const result = await command.execute(
      { confirmation: 'confirm' },
      { history: [], sessionId: 'ceo-session' } as any
    );

    expect(result).toEqual({
      status: 'ok',
      message: 'No active workflow run is associated with this chat session.',
      data: {
        outcome: 'no_active_workflow',
        cancelled: false,
        sessionId: 'ceo-session',
      },
    });
    expect(workflowActorHost.getLiveRun).not.toHaveBeenCalled();
  });

  it('returns a structured error when the active run is not loaded in memory', async () => {
    const workflowInteractions = {
      resolveActiveRun: vi.fn(async () => ({ id: 'onboarding:1' })),
    };
    const workflowActorHost = {
      getLiveRun: vi.fn(() => undefined),
    };
    const command = new CancelChatCommand(workflowInteractions as any, workflowActorHost as any);

    const result = await command.execute(
      { confirmation: 'confirm' },
      { history: [], sessionId: 'ceo-session' } as any
    );

    expect(result).toEqual({
      status: 'error',
      message: "Workflow run 'onboarding:1' is active but is not loaded in this process.",
      data: {
        outcome: 'workflow_not_loaded',
        cancelled: false,
        workflowRunId: 'onboarding:1',
        sessionId: 'ceo-session',
      },
    });
  });
});

