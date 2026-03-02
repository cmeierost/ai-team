import type { MediatorEvent, AiTeamCommandName } from '@ai-team/service';

export interface WebSocketStreamOptions {
  url: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  onQuestion?: (question: any) => Promise<any>;
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
  data: any;
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
  let abortHandler: (() => void) | null = null;
  let readyResolve: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  ws.onopen = () => {
    // WebSocket is open, but wait for 'ready' message from server
  };

  ws.onmessage = (event) => {
    try {
      const wsEvent: WebSocketEvent = JSON.parse(event.data);
      
      if (wsEvent.type === 'status' && wsEvent.data?.status === 'ready') {
        // Server is ready, signal that we can send
        readyResolve?.();
        return;
      }

      if (wsEvent.type === 'question') {
        if (options.disableQuestions) {
          if (ws.readyState === WebSocket.OPEN) {
            const cancelPayload: WebSocketMessage = { type: 'cancel' };
            ws.send(JSON.stringify(cancelPayload));
          }
          done = true;
          ws.close();
          return;
        }

        const sendAnswer = (value: any) => {
          const answerPayload: WebSocketMessage = {
            type: 'answer',
            answer: {
              questionId: wsEvent.data.questionId,
              value,
            },
          };
          ws.send(JSON.stringify(answerPayload));
        };

        if (options.onQuestion) {
          options.onQuestion(wsEvent.data)
            .then((answer) => {
              sendAnswer(answer);
            })
            .catch((err) => {
              console.error('Failed to get answer for question:', err);
              const fallback = wsEvent.data?.kind === 'confirm'
                ? false
                : wsEvent.data?.kind === 'checklist'
                  ? []
                  : '';
              sendAnswer(fallback);
            });
        } else {
          const fallback = wsEvent.data?.kind === 'confirm'
            ? false
            : wsEvent.data?.kind === 'checklist'
              ? []
              : '';
          sendAnswer(fallback);
        }
        return;
      }

      if (wsEvent.type === 'done') {
        done = true;
        ws.close();
        return;
      }

      // Convert WebSocket event to MediatorEvent
      const mediatorEvent = wsEvent.data as MediatorEvent<TCommand>;
      events.push(mediatorEvent);
    } catch (err) {
      error = err instanceof Error ? err : new Error('Failed to parse WebSocket message');
    }
  };

  ws.onerror = (event) => {
    error = new Error('WebSocket error');
    done = true;
  };

  ws.onclose = () => {
    done = true;
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
        ...(options.messageOptions || {}),
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
        // Wait a bit for more events
        await new Promise((resolve) => setTimeout(resolve, 10));
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
