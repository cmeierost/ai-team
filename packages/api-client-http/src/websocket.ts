import type { MediatorEvent, AiTeamCommandName } from '@ai-team/service';

export interface WebSocketStreamOptions {
  url: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  onQuestion?: (question: any) => Promise<any>;
}

interface WebSocketMessage {
  type: 'message' | 'cancel';
  content?: string;
  options?: any;
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
  const ws = new WebSocket(`${options.url}/ws/chat/${agentId}`);
  const events: MediatorEvent<TCommand>[] = [];
  let error: Error | null = null;
  let done = false;
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
        // Handle question - invoke callback and send answer back
        if (options.onQuestion) {
          options.onQuestion(wsEvent.data).then((answer) => {
            ws.send(JSON.stringify({
              type: 'answer',
              answer: {
                questionId: wsEvent.data.questionId,
                value: answer,
              },
            }));
          }).catch((err) => {
            console.error('Failed to get answer for question:', err);
            // Send a default/empty answer to unblock the server
            ws.send(JSON.stringify({
              type: 'answer',
              answer: {
                questionId: wsEvent.data.questionId,
                value: '',
              },
            }));
          });
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
    // Wait for ready signal
    await readyPromise;

    // Send the message
    const messagePayload: WebSocketMessage = {
      type: 'message',
      content: message,
      options: {},
    };
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
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
}
