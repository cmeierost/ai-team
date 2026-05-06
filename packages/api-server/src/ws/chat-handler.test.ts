import { describe, expect, it, vi } from 'vitest';
import type { InteractionContext, InteractionRequest } from '@ai-team/api-contracts';
import type { IInteractionService } from '@ai-team/service';
import { setupChatWebSocket } from './chat-handler.js';

class MockWebSocket {
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;

  on(event: string, listener: (...args: any[]) => void) {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  send(payload: string) {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }

  close() {
    this.closed = true;
    this.emit('close');
  }

  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  emitClientMessage(payload: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
  }
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('setupChatWebSocket', () => {
  it('forwards non-confirm questions over the websocket and resumes streaming after an answer', async () => {
    const ws = new MockWebSocket();
    const stream = vi.fn(async function* (
      _request: InteractionRequest<'chat'>,
      context: InteractionContext = {}
    ) {
      const selection = await context.questionSelect?.({
        message: 'Choose a teammate',
        choices: [
          { name: 'Emily Davis', value: 'emily-davis' },
          { name: 'Sarah Lee', value: 'sarah-lee' },
        ],
      });

      yield {
        kind: 'token' as const,
        command: 'chat' as const,
        timestamp: new Date().toISOString(),
        text: `selected:${selection}`,
      };

      yield {
        kind: 'done' as const,
        command: 'chat' as const,
        timestamp: new Date().toISOString(),
      };
    });

    const interactionService: IInteractionService = {
      stream,
    };

    await setupChatWebSocket(
      ws as unknown as any,
      'michael-brown',
      interactionService,
      {} as any,
      null
    );

    expect(ws.sent[0]).toMatchObject({ type: 'ready' });

    ws.emitClientMessage({
      type: 'message',
      content: 'Connect me to someone else',
      options: {},
    });

    await flushAsync();

    expect(ws.sent).toContainEqual({ type: 'ack' });
    expect(ws.sent).toContainEqual({
      type: 'question',
      data: {
        questionId: 'q1',
        kind: 'select',
        message: 'Choose a teammate',
        choices: [
          { name: 'Emily Davis', value: 'emily-davis' },
          { name: 'Sarah Lee', value: 'sarah-lee' },
        ],
      },
    });

    ws.emitClientMessage({
      type: 'answer',
      answer: {
        questionId: 'q1',
        value: 'sarah-lee',
      },
    });

    await flushAsync();

    expect(stream).toHaveBeenCalledOnce();
    expect(ws.sent).toContainEqual({
      type: 'mediator',
      data: expect.objectContaining({
        kind: 'token',
        text: 'selected:sarah-lee',
      }),
    });
  });
});
