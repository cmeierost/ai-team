import { StreamEvent } from './contract/index.js';

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
  data?: unknown;
}

function normalizeQuestionPayload(payload: Record<string, unknown>) {
  if (typeof payload.kind === 'string' && payload.kind !== 'question') {
    return payload;
  }

  return {
    ...payload,
    kind: typeof payload.questionType === 'string' ? payload.questionType : 'input',
  };
}

export async function* streamViaWebSocket<TCommand extends string = string>(
  agentId: string,
  message: string,
  options: WebSocketStreamOptions
): AsyncIterable<StreamEvent<TCommand>> {
  const encodedAgentId = encodeURIComponent(agentId);
  const wsUrl = options.sessionId
    ? `${options.url}/ws/chat/${encodedAgentId}?sessionId=${encodeURIComponent(options.sessionId)}`
    : `${options.url}/ws/chat/${encodedAgentId}`;
  const ws = new WebSocket(wsUrl);
  const events: StreamEvent<TCommand>[] = [];
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

  const waitForNextEvent = () =>
    new Promise<void>((resolve) => {
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

      const handleQuestion = (rawQuestion: Record<string, unknown>) => {
        const question = normalizeQuestionPayload(rawQuestion);

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
          options
            .onQuestion(question)
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
      };

      if (wsEvent.type === 'ready') {
        // Server is ready, signal that we can send
        readyResolve?.();
        return;
      }

      if (wsEvent.type === 'ack' || wsEvent.type === 'cancelled') {
        if (wsEvent.type === 'cancelled') {
          done = true;
          wakeEventWaiter();
        }
        return;
      }

      if (wsEvent.type === 'error') {
        const message = (wsEvent.data as { error?: string } | undefined)?.error;
        error = new Error(message || 'WebSocket stream error');
        done = true;
        wakeEventWaiter();
        return;
      }

      // Backward-compat: older server used { type: 'status', data: { status: 'ready' } }
      if (
        wsEvent.type === 'status' &&
        (wsEvent.data as { status?: string } | null)?.status === 'ready'
      ) {
        readyResolve?.();
        return;
      }

      if (wsEvent.type === 'question') {
        handleQuestion((wsEvent.data as Record<string, unknown>) ?? {});
        return;
      }

      if (wsEvent.type === 'mediator') {
        const streamEvent = wsEvent.data as StreamEvent<TCommand>;
        if (streamEvent.kind === 'question') {
          handleQuestion({
            ...(streamEvent as unknown as Record<string, unknown>),
            questionId: streamEvent.requestId ?? 'mediator-question',
          });
          return;
        }
        if (streamEvent.kind === 'done' || streamEvent.kind === 'turn_finished') {
          events.push(streamEvent);
          done = true;
          ws.close();
          wakeEventWaiter();
          return;
        }

        events.push(streamEvent);
        if (streamEvent.kind === 'aborted' || streamEvent.kind === 'error') {
          done = true;
        }
        wakeEventWaiter();
        return;
      }

      // Backward-compat: older server sent direct mediator kind as top-level type
      if (wsEvent.type === 'done') {
        done = true;
        ws.close();
        wakeEventWaiter();
        return;
      }

      if (wsEvent.data) {
        const streamEvent = wsEvent.data as StreamEvent<TCommand>;
        events.push(streamEvent);
        wakeEventWaiter();
      }
    } catch (err) {
      error = err instanceof Error ? err : new Error('Failed to parse WebSocket message');
      wakeEventWaiter();
    }
  };

  ws.onerror = (_event) => {
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

export interface SummarizeNoteWebSocketOptions {
  /** API base URL (http/https — will be converted to ws/wss automatically) */
  url: string;
  sessionId: string;
  noteId: string;
  operation: 'compact' | 'crawl';
  websiteUrl?: string;
  maxPages?: number;
  maxWords?: number;
  focusInstruction?: string;
  generateTitle?: boolean;
  signal?: AbortSignal;
  /** Called for each status/progress event */
  onStatus?: (status: string) => void;
}

/**
 * Runs an LLM-backed note summarize operation over WebSocket and yields stream events.
 * The caller should listen for a `done` event with `result` being the updated Note.
 */
export async function* summarizeNoteViaWebSocket(
  agentId: string,
  options: SummarizeNoteWebSocketOptions
): AsyncIterable<StreamEvent<'chat'>> {
  const httpBase = options.url.replace(/\/$/, '');
  const wsBase = httpBase.replace(/^http/, 'ws');
  const encodedAgentId = encodeURIComponent(agentId);
  const wsUrl = `${wsBase}/ws/chat/${encodedAgentId}?sessionId=${encodeURIComponent(options.sessionId)}`;

  const ws = new WebSocket(wsUrl);
  const events: StreamEvent<'chat'>[] = [];
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

  const waitForNextEvent = () =>
    new Promise<void>((resolve) => {
      eventWaiter = () => {
        eventWaiter = null;
        resolve();
      };
      if (events.length > 0 || done || error) {
        wakeEventWaiter();
      }
    });

  ws.onmessage = (event) => {
    try {
      const wsEvent: { type: string; data?: unknown } = JSON.parse(event.data);

      if (wsEvent.type === 'ready') {
        readyResolve?.();
        return;
      }

      if (wsEvent.type === 'ack' || wsEvent.type === 'cancelled') {
        if (wsEvent.type === 'cancelled') {
          done = true;
          wakeEventWaiter();
        }
        return;
      }

      if (wsEvent.type === 'error') {
        const message = (wsEvent.data as { error?: string } | undefined)?.error;
        error = new Error(message || 'WebSocket summarize error');
        done = true;
        wakeEventWaiter();
        return;
      }

      if (wsEvent.type === 'mediator') {
        const streamEvent = wsEvent.data as StreamEvent<'chat'>;
        if (streamEvent.kind === 'status') {
          options.onStatus?.((streamEvent as any).status ?? '');
        }
        if (streamEvent.kind === 'done' || streamEvent.kind === 'turn_finished') {
          events.push(streamEvent);
          done = true;
          ws.close();
          wakeEventWaiter();
          return;
        }
        events.push(streamEvent);
        if (streamEvent.kind === 'aborted' || streamEvent.kind === 'error') {
          done = true;
        }
        wakeEventWaiter();
      }
    } catch (err) {
      error = err instanceof Error ? err : new Error('Failed to parse WebSocket message');
      wakeEventWaiter();
    }
  };

  ws.onerror = () => {
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
          ws.send(JSON.stringify({ type: 'cancel' }));
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

    await readyPromise;

    const payload: Record<string, unknown> = {
      type: 'summarize',
      operation: options.operation,
      noteId: options.noteId,
      maxWords: options.maxWords,
      focusInstruction: options.focusInstruction,
      generateTitle: options.generateTitle,
    };
    if (options.operation === 'crawl') {
      payload.websiteUrl = options.websiteUrl;
      payload.maxPages = options.maxPages;
    }
    ws.send(JSON.stringify(payload));

    while (!done || events.length > 0) {
      if (error) {
        throw error;
      }
      if (events.length > 0) {
        const ev = events.shift()!;
        yield ev;
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
