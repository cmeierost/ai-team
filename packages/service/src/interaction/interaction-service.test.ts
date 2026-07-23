import { describe, expect, it } from 'vitest';
import type { ChatOptions, WorkflowCallbacks } from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';
import { EmitService } from './emit-service.js';
import { InteractionService } from './interaction-service.js';

describe('InteractionService', () => {
  it('streams events emitted by the scoped chat dispatcher', async () => {
    const emitService = new EmitService(() => {});
    const runChat = async (
      _workspaceRoot: string,
      _agentId: string | undefined,
      _options: ChatOptions,
      _callbacks: WorkflowCallbacks,
      _ctx: ExecutionContext
    ) => {
      emitService.toolEvent(
        'slash:help',
        undefined,
        'result',
        'Available commands',
        undefined,
        {
          toolName: 'slash:help',
          outcome: 'result',
          commandResponse: {
            status: 'ok',
            message: 'Available commands',
          },
        }
      );
    };
    const service = new InteractionService('/workspace', runChat, emitService);

    const events = [];
    for await (const event of service.stream({
      command: 'chat-chat',
      payload: { agentId: 'michael-brown', message: '/help' },
    })) {
      events.push(event);
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'slash:help',
        toolPhase: 'result',
      })
    );
  });
});
