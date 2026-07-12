import { describe, expect, it, vi } from 'vitest';
import { ChatLoopEngineV2 } from './chat-loop-engine.js';
import { ChatRuntimeV2 } from './chat-runtime.js';

describe('ChatRuntimeV2', () => {
  it('sets skipPersist=false for first hop and true for handoff follow-up hops', async () => {
    const sendTurnSpy = vi.fn(async ({ hop }: { hop: number }) => ({
      text: `hop-${hop}`,
      toolRoundNeeded: false,
    }));

    const runtime = new ChatRuntimeV2(
      {
        runPreturnInterceptorsAsync: vi.fn(async () => ({ outcome: 'continue' as const })),
        runSendTurnAsync: sendTurnSpy,
        runPostTurnResolutionAsync: vi
          .fn()
          .mockResolvedValueOnce({ outcome: 'handoff_required' as const })
          .mockResolvedValueOnce({ outcome: 'normal_complete' as const }),
        runHandoffTransitionAsync: vi.fn(async () => ({ autoMessage: 'handoff-react' })),
      },
      new ChatLoopEngineV2()
    );

    const output = await runtime.runAsync({ message: 'start', maxHops: 2 });

    expect(output.status).toBe('completed');
    expect(sendTurnSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        hop: 0,
        options: expect.objectContaining({ skipPersist: false }),
      })
    );
    expect(sendTurnSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        hop: 1,
        options: expect.objectContaining({ skipPersist: true }),
      })
    );
  });

  it('sets skipPersist=true for auto-react message on hop 0', async () => {
    const sendTurnSpy = vi.fn(async () => ({
      text: 'done',
      toolRoundNeeded: false,
    }));

    const runtime = new ChatRuntimeV2(
      {
        runPreturnInterceptorsAsync: vi.fn(async () => ({
          outcome: 'forwarded' as const,
          autoMessage: '[Handoff received] continue',
        })),
        runSendTurnAsync: sendTurnSpy,
        runPostTurnResolutionAsync: vi.fn(async () => ({ outcome: 'normal_complete' as const })),
        runHandoffTransitionAsync: vi.fn(async () => ({})),
      },
      new ChatLoopEngineV2()
    );

    await runtime.runAsync({
      message: 'forward me',
      autoReactMessage: '[Handoff received] continue',
      maxHops: 1,
    });

    expect(sendTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hop: 0,
        userMessage: '[Handoff received] continue',
        options: expect.objectContaining({ skipPersist: true }),
      })
    );
  });
});
