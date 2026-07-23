import { describe, expect, it, vi } from 'vitest';
import { StreamingClient } from './streaming-client.js';
import type { StreamEvent } from './contract/routers/streaming.js';

const streamViaWebSocketMock = vi.hoisted(() => vi.fn());

vi.mock('./websocket.js', () => ({
  streamViaWebSocket: streamViaWebSocketMock,
}));

describe('StreamingClient', () => {
  it('supports the service chat command used by the web frontend', () => {
    streamViaWebSocketMock.mockReturnValue((async function* () {})());
    const client = new StreamingClient('http://localhost:3002', 'ws://localhost:3002');

    client.stream(
      {
        command: 'chat-chat',
        payload: {
          agentId: 'michael-brown',
          message: 'hello',
          sessionId: 'session-1',
          createNewSession: true,
        },
      },
      { signal: new AbortController().signal } as any
    );

    expect(streamViaWebSocketMock).toHaveBeenCalledWith(
      'michael-brown',
      'hello',
      expect.objectContaining({
        url: 'ws://localhost:3002',
        sessionId: 'session-1',
        messageOptions: expect.objectContaining({ createNewSession: true }),
      })
    );
  });

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
