import { describe, expect, it, vi } from 'vitest';
import { StreamingClient } from './streaming-client.js';
import type { StreamEvent } from './contract/routers/streaming.js';

const streamViaWebSocketMock = vi.hoisted(() => vi.fn());

vi.mock('./websocket.js', () => ({
  streamViaWebSocket: streamViaWebSocketMock,
}));

describe('StreamingClient', () => {
  it('uses legacy ctx question handlers when no .on handlers are registered', async () => {
    streamViaWebSocketMock.mockImplementation(async function* (
      _agentId: string,
      _message: string,
      options: { onQuestion?: (q: Record<string, unknown>) => Promise<unknown> }
    ) {
      const answer = await options.onQuestion?.({
        kind: 'input',
        questionId: 'q-1',
        message: 'Name?',
      });

      yield {
        kind: 'token',
        command: 'chat',
        requestId: 'r1',
        timestamp: new Date().toISOString(),
        text: typeof answer === 'string' ? answer : '',
      };

      yield {
        kind: 'done',
        command: 'chat',
        requestId: 'r1',
        timestamp: new Date().toISOString(),
      };
    });

    const client = new StreamingClient('http://localhost:3002', 'ws://localhost:3002');
    const input = vi.fn(async () => 'alice');

    const stream = client.stream(
      {
        command: 'chat',
        payload: {
          employeeId: 'michael-brown',
          options: { message: 'hello' },
        },
      },
      {
        input,
      }
    );

    const events: StreamEvent<'chat'>[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(input).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'token', text: 'alice' }));
  });
});
