import { describe, expect, it, vi } from 'vitest';
import type { ChatOptions } from '@ai-team/api-contracts';
import { InteractionService } from '@ai-team/service';

describe('InteractionService', () => {
  it('streams chat runtime events and completion markers', async () => {
    const runChat = vi.fn(
      async (
        _workspaceRoot: string,
        _agentId: string | undefined,
        _options: ChatOptions,
        hooks: { emit?: (event: unknown) => void }
      ) => {
        hooks.emit?.({
          kind: 'agent_info',
          agentId: 'michael-brown',
          agentName: 'Michael Brown',
          agentRole: 'ceo',
        });
        hooks.emit?.({ kind: 'token', text: 'Hello from the API server.' });
      }
    );

    const service = new InteractionService('c:\\Projects\\ai-team', runChat);

    const events = [] as Array<{ kind: string; [key: string]: unknown }>;
    for await (const event of service.stream({
      command: 'chat',
      payload: {
        employeeId: 'michael-brown',
        options: { message: 'Hello' },
      },
    })) {
      events.push(event as { kind: string; [key: string]: unknown });
    }

    expect(runChat).toHaveBeenCalledOnce();
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
