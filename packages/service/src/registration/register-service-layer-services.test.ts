import { describe, expect, it, vi } from 'vitest';
import { COMMAND_FACTORY_TOKENS } from '../types.js';
import { buildInteractionService } from './register-service-layer-services.js';
import { EmitService } from '../interaction/emit-service.js';

describe('buildInteractionService', () => {
  it('does not replay response.data as token after chat dispatch completes', async () => {
    const dispatch = vi.fn(async () => ({
      status: 'ok' as const,
      message: 'completed',
      data: 'already streamed content',
    }));

    const container = {
      resolve: (token: unknown) => {
        if (token === COMMAND_FACTORY_TOKENS.CommandDispatcher) {
          return { dispatch };
        }
        throw new Error(`Unexpected token: ${String(token)}`);
      },
    } as any;

    const interactionService = buildInteractionService(container, '/workspace');
    const runtimeEvents: Array<{ kind: string; text?: string }> = [];
    const emitService = new EmitService((event) => {
      if (event.kind === 'token' || event.kind === 'log' || event.kind === 'status') {
        runtimeEvents.push(event as { kind: string; text?: string });
      }
    });

    const streamEvents: Array<{ kind: string; text?: string }> = [];
    for await (const event of interactionService.stream(
      {
        command: 'chat-chat',
        payload: { agentId: 'sarah-lee', message: 'hello' },
      },
      {
        emitService,
      }
    )) {
      streamEvents.push(event as { kind: string; text?: string });
    }

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(runtimeEvents.filter((event) => event.kind === 'token')).toHaveLength(0);
    expect(streamEvents.some((event) => event.kind === 'token')).toBe(false);
    expect(streamEvents.map((event) => event.kind)).toContain('result');
    expect(streamEvents.map((event) => event.kind)).toContain('turn_finished');
  });
});
