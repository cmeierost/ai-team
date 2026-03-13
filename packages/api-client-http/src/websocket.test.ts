import { describe, expect, it, vi } from 'vitest';
import { streamViaWebSocket } from './websocket.js';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sentMessages: string[] = [];

  constructor(_url: string) {
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
      this.emit({ type: 'status', data: { status: 'ready' } });
    });
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

describe('streamViaWebSocket', () => {
  it('cancels immediately when disableQuestions is enabled', async () => {
    const wsInstances: MockWebSocket[] = [];
    const WebSocketMock = vi.fn(function (this: unknown, url: string) {
      const instance = new MockWebSocket(url);
      wsInstances.push(instance);
      return instance;
    });
    Object.assign(WebSocketMock, {
      CONNECTING: MockWebSocket.CONNECTING,
      OPEN: MockWebSocket.OPEN,
      CLOSING: MockWebSocket.CLOSING,
      CLOSED: MockWebSocket.CLOSED,
    });

    vi.stubGlobal('WebSocket', WebSocketMock as unknown as typeof WebSocket);

    const iterator = streamViaWebSocket<any>('agent-1', 'hello', {
      url: 'ws://localhost:3002',
      disableQuestions: true,
    });

    const consumePromise = (async () => {
      const events: unknown[] = [];
      for await (const event of iterator) {
        events.push(event);
      }
      return events;
    })();

    await new Promise((resolve) => setTimeout(resolve, 5));

    const ws = wsInstances[0];
    expect(ws).toBeDefined();

    ws.emit({
      type: 'question',
      data: {
        questionId: 'q-1',
        kind: 'input',
        message: 'What is your name?',
      },
    });

    const events = await consumePromise;
    expect(events).toEqual([]);

    const parsedMessages = ws.sentMessages.map((payload) => JSON.parse(payload));
    expect(parsedMessages.some((message) => message.type === 'cancel')).toBe(true);
  });

  it('requests an answer and continues when questions are enabled', async () => {
    const wsInstances: MockWebSocket[] = [];
    const WebSocketMock = vi.fn(function (this: unknown, url: string) {
      const instance = new MockWebSocket(url);
      wsInstances.push(instance);
      return instance;
    });
    Object.assign(WebSocketMock, {
      CONNECTING: MockWebSocket.CONNECTING,
      OPEN: MockWebSocket.OPEN,
      CLOSING: MockWebSocket.CLOSING,
      CLOSED: MockWebSocket.CLOSED,
    });

    vi.stubGlobal('WebSocket', WebSocketMock as unknown as typeof WebSocket);

    const onQuestion = vi.fn(async () => 'chosen-value');
    const iterator = streamViaWebSocket<any>('agent-1', 'hello', {
      url: 'ws://localhost:3002',
      disableQuestions: false,
      onQuestion,
    });

    const consumePromise = (async () => {
      const events: unknown[] = [];
      for await (const event of iterator) {
        events.push(event);
      }
      return events;
    })();

    await new Promise((resolve) => setTimeout(resolve, 5));

    const ws = wsInstances[0];
    expect(ws).toBeDefined();

    ws.emit({
      type: 'question',
      data: {
        questionId: 'q-2',
        kind: 'select',
        message: 'Select one',
        choices: [
          { name: 'A', value: 'a' },
          { name: 'B', value: 'b' },
        ],
      },
    });

    ws.emit({
      type: 'tool',
      data: {
        kind: 'tool',
        command: 'chat',
        timestamp: new Date().toISOString(),
        toolName: 'com_ask',
      },
    });

    ws.emit({ type: 'done', data: {} });

    const events = await consumePromise;
    expect(events).toHaveLength(1);
    expect(onQuestion).toHaveBeenCalledTimes(1);

    const parsedMessages = ws.sentMessages.map((payload) => JSON.parse(payload));
    expect(parsedMessages.some((message) => message.type === 'cancel')).toBe(false);
    expect(parsedMessages.some((message) => message.type === 'answer' && message.answer?.value === 'chosen-value')).toBe(true);
  });
});
