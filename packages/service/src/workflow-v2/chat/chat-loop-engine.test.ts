import { describe, expect, it, vi } from 'vitest';
import { ChatLoopEngineV2 } from './chat-loop-engine.js';

describe('ChatLoopEngineV2', () => {
  it('completes normal flow without handoff', async () => {
    const engine = new ChatLoopEngineV2();
    const services = {
      runPreturnInterceptorsAsync: vi.fn(async () => ({ outcome: 'continue' as const })),
      runSendTurnAsync: vi.fn(async () => ({ text: 'done', toolRoundNeeded: false })),
      runPostTurnResolutionAsync: vi.fn(async () => ({ outcome: 'normal_complete' as const })),
      runHandoffTransitionAsync: vi.fn(async () => ({})),
    };

    const output = await engine.runAsync({ message: 'hello' }, services);

    expect(output).toEqual({
      status: 'completed',
      text: 'done',
      hopCount: 0,
    });
    expect(services.runHandoffTransitionAsync).not.toHaveBeenCalled();
  });

  it('returns max_hops_reached when handoff loops exceed max hops', async () => {
    const engine = new ChatLoopEngineV2({ defaultMaxHops: 1 });
    const services = {
      runPreturnInterceptorsAsync: vi.fn(async () => ({ outcome: 'continue' as const })),
      runSendTurnAsync: vi.fn(async ({ hop }: { hop: number }) => ({
        text: `hop-${hop}`,
        toolRoundNeeded: false,
      })),
      runPostTurnResolutionAsync: vi.fn(async () => ({ outcome: 'handoff_required' as const })),
      runHandoffTransitionAsync: vi.fn(async () => ({ autoMessage: 'react' })),
    };

    const output = await engine.runAsync({ message: 'start' }, services);

    expect(output).toEqual({
      status: 'max_hops_reached',
      text: 'hop-1',
      hopCount: 1,
    });
    expect(services.runSendTurnAsync).toHaveBeenCalledTimes(2);
    expect(services.runHandoffTransitionAsync).toHaveBeenCalledTimes(1);
  });

  it('fails when tool round is requested but not configured', async () => {
    const engine = new ChatLoopEngineV2();
    const services = {
      runPreturnInterceptorsAsync: vi.fn(async () => ({ outcome: 'continue' as const })),
      runSendTurnAsync: vi.fn(async () => ({
        text: 'need tool',
        toolRoundNeeded: true,
        pendingToolCall: { toolName: 'fs_read', args: { filePath: 'README.md' } },
      })),
      runPostTurnResolutionAsync: vi.fn(async () => ({ outcome: 'normal_complete' as const })),
      runHandoffTransitionAsync: vi.fn(async () => ({})),
      runFailureAsync: vi.fn(async () => {}),
    };

    const output = await engine.runAsync({ message: 'run tool' }, services);

    expect(output.status).toBe('failed');
    expect(output.error).toContain('No tool round service configured');
    expect(services.runFailureAsync).toHaveBeenCalledTimes(1);
  });

  it('short-circuits to completed when preturn consumes input', async () => {
    const engine = new ChatLoopEngineV2();
    const services = {
      runPreturnInterceptorsAsync: vi.fn(async () => ({
        outcome: 'consumed' as const,
        text: 'handled in preturn',
      })),
      runSendTurnAsync: vi.fn(async () => ({ text: 'unused', toolRoundNeeded: false })),
      runPostTurnResolutionAsync: vi.fn(async () => ({ outcome: 'normal_complete' as const })),
      runHandoffTransitionAsync: vi.fn(async () => ({})),
    };

    const output = await engine.runAsync({ message: 'hello' }, services);

    expect(output).toEqual({
      status: 'completed',
      text: 'handled in preturn',
      hopCount: 0,
    });
    expect(services.runSendTurnAsync).not.toHaveBeenCalled();
  });
});
