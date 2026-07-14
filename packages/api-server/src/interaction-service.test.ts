import { describe, expect, it } from 'vitest';
import type { ChatOptions } from '@ai-team/api-contracts';
import { InteractionService } from '@ai-team/service';

describe('InteractionService', () => {
  it('streams chat runtime events and completion markers', async () => {
    let runChatCalls = 0;
    const runChat: ConstructorParameters<typeof InteractionService>[1] = async (
      _workspaceRoot: string,
      _agentId: string | undefined,
      _options: ChatOptions,
      hooks
    ) => {
      runChatCalls += 1;
      if (!hooks.emitService) {
        throw new Error('emitService missing in interaction hooks');
      }
      hooks.emitService.emit({
        kind: 'agent_info',
        agentId: 'michael-brown',
        agentName: 'Michael Brown',
        agentRole: 'ceo',
      });
      hooks.emitService.emit({ kind: 'token', text: 'Hello from the API server.' });
    };

    const service = new InteractionService(String.raw`c:\Projects\ai-team`, runChat);

    const events = [] as Array<{ kind: string; [key: string]: unknown }>;
    for await (const event of service.stream({
      command: 'chat-chat',
      payload: {
        agentId: 'michael-brown',
        message: 'Hello',
      },
    })) {
      events.push(event);
    }

    expect(runChatCalls).toBe(1);
    expect(events.map((event) => event.kind)).toEqual([
      'started',
      'agent_info',
      'token',
      'result',
      'done',
    ]);
    expect(events[1]).toMatchObject({
      kind: 'agent_info',
      agentId: 'michael-brown',
      agentName: 'Michael Brown',
      agentRole: 'ceo',
    });
    expect(events[2]).toMatchObject({
      kind: 'token',
      text: 'Hello from the API server.',
    });
  });
});
