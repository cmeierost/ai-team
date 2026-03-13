import type { MediatorEvent, AiTeamCommandName } from '@ai-team/service';

export interface WebSocketStreamOptions {
  url: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  onQuestion?: (question: Record<string, unknown>) => Promise<any>;
  disableQuestions?: boolean;
  signal?: AbortSignal;
  sessionId?: string;
  messageOptions?: Record<string, unknown>;
}

interface WebSocketMessage {
  type: 'message' | 'cancel' | 'answer';
  content?: string;
  options?: any;
  answer?: {
    questionId: string;
    value: any;
  };
}

interface WebSocketEvent {
  type: string;
  data: unknown;
}

export async function* streamViaWebSocket<TCommand extends AiTeamCommandName>(
  agentId: string,
  message: string,
  options: WebSocketStreamOptions
): AsyncIterable<MediatorEvent<TCommand>> {
  const encodedAgentId = encodeURIComponent(agentId);
  const wsUrl = options.sessionId
    ? `${options.url}/ws/chat/${encodedAgentId}?sessionId=${encodeURIComponent(options.sessionId)}`
    : `${options.url}/ws/chat/${encodedAgentId}`;
  const ws = new WebSocket(wsUrl);
  const events: MediatorEvent<TCommand>[] = [];
  let error: Error | null = null;
  let done = false;
  let eventWaiter: (() => void) | null = null;
  let abortHandler: (() => void) | null = null;
  let readyResolve: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const wakeEventWaiter = () => {
    const waiter = eventWaiter;
    eventWaiter = null;
    waiter?.();
  };

  const waitForNextEvent = () => new Promise<void>((resolve) => {
    eventWaiter = () => {
      eventWaiter = null;
      resolve();
    };

    if (events.length > 0 || done || error) {
      wakeEventWaiter();
    }
  });

  ws.onopen = () => {
    // WebSocket is open, but wait for 'ready' message from server
  };

  ws.onmessage = (event) => {
    try {
      const wsEvent: WebSocketEvent = JSON.parse(event.data);
      
      if (wsEvent.type === 'status' && (wsEvent.data as { status?: string } | null)?.status === 'ready') {
        // Server is ready, signal that we can send
        readyResolve?.();
        return;
      }

      if (wsEvent.type === 'question') {
        const question = wsEvent.data as Record<string, unknown>;
        if (options.disableQuestions) {
          if (ws.readyState === WebSocket.OPEN) {
            const cancelPayload: WebSocketMessage = { type: 'cancel' };
            ws.send(JSON.stringify(cancelPayload));
          }
          done = true;
          ws.close();
          return;
        }

        const sendAnswer = (value: unknown) => {
          const answerPayload: WebSocketMessage = {
            type: 'answer',
            answer: {
              questionId: (question as any).questionId,
              value: value as any,
            },
          };
          ws.send(JSON.stringify(answerPayload));
        };

        if (options.onQuestion) {
          options.onQuestion(question)
            .then((answer) => {
              sendAnswer(answer);
            })
            .catch((err) => {
              console.error('Failed to get answer for question:', err);
              sendAnswer(false);
            });
        } else {
          sendAnswer(false);
        }
        return;
      }

      if (wsEvent.type === 'done') {
        done = true;
        ws.close();
        wakeEventWaiter();
        return;
      }

      // Convert WebSocket event to MediatorEvent
      const mediatorEvent = wsEvent.data as MediatorEvent<TCommand>;
      events.push(mediatorEvent);
      wakeEventWaiter();
    } catch (err) {
      error = err instanceof Error ? err : new Error('Failed to parse WebSocket message');
      wakeEventWaiter();
    }
  };

  ws.onerror = (event) => {
    error = new Error('WebSocket error');
    done = true;
    wakeEventWaiter();
  };

  ws.onclose = () => {
    done = true;
    wakeEventWaiter();
  };

  try {
    abortHandler = () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          const cancelPayload: WebSocketMessage = { type: 'cancel' };
          ws.send(JSON.stringify(cancelPayload));
        }
      } finally {
        done = true;
        wakeEventWaiter();
      }
    };

    if (options.signal) {
      if (options.signal.aborted) {
        abortHandler();
      } else {
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    // Wait for ready signal
    await readyPromise;

    // Send the message
    const messagePayload: WebSocketMessage = {
      type: 'message',
      content: message,
      options: {
        ...(options.messageOptions ?? undefined),
      },
    };
    if (messagePayload.options && 'message' in messagePayload.options) {
      delete messagePayload.options.message;
    }
    if (messagePayload.options && 'sessionId' in messagePayload.options) {
      delete messagePayload.options.sessionId;
    }
    ws.send(JSON.stringify(messagePayload));

    // Yield events as they arrive
    while (!done || events.length > 0) {
      if (error) {
        throw error;
      }

      if (events.length > 0) {
        const event = events.shift()!;
        yield event;
      } else if (!done) {
        await waitForNextEvent();
      }
    }
  } finally {
    if (options.signal && abortHandler) {
      options.signal.removeEventListener('abort', abortHandler);
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
}
