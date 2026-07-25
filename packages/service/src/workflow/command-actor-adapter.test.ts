import { describe, expect, it, vi } from 'vitest';
import { createActor, toPromise } from 'xstate';
import type { ICommand, PreparedCommandInvocation } from '@ai-team/core';
import { OrdinaryCommandActorAdapter } from './command-actor-adapter.js';

describe('OrdinaryCommandActorAdapter', () => {
  it('executes a normal command once with the prepared parameters and cancellation signal', async () => {
    const execute = vi.fn(async (params: unknown, ctx: { signal?: AbortSignal }) => ({
      status: 'ok' as const,
      data: { params, aborted: ctx.signal?.aborted ?? false },
    }));
    const command = {
      metadata: {
        key: 'ordinary',
        description: 'ordinary command',
        availableIn: {},
      },
      execute,
    } satisfies ICommand;
    const input: PreparedCommandInvocation = {
      commandKey: 'ordinary',
      params: { approved: true },
      context: { history: [] },
      idempotencyKey: 'parent-run:ordinary-step:1',
    };
    const actor = createActor(new OrdinaryCommandActorAdapter().toActorLogic(command), { input }).start();

    await expect(toPromise(actor)).resolves.toEqual({
      status: 'ok',
      data: { params: { approved: true }, aborted: false },
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      { approved: true },
      expect.objectContaining({
        history: [],
        signal: expect.any(AbortSignal),
        commandInvocation: { callId: 'parent-run:ordinary-step:1', toolName: 'ordinary' },
      })
    );
  });
});
