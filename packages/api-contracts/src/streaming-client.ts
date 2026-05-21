import type {
  InteractionRequest,
  StreamEvent,
  IStreamingClient,
  QuestionHandlerMap,
  QuestionConfirmRequest,
  QuestionSelectRequest,
  QuestionPasswordRequest,
  QuestionChecklistRequest,
  QuestionInputRequest,
  ChatOptions,
} from './contract/routers/streaming.js';
import { streamViaWebSocket } from './websocket.js';

// ─── Factory ──────────────────────────────────────────────────────────────────

export class StreamingClient implements IStreamingClient {
  private readonly wsBaseUrl: string;
  constructor(baseUrl: string, wsUrl: string) {
    this.wsBaseUrl = wsUrl ?? baseUrl.replace(/^http/, 'ws');
  }

  stream<TCommand extends string = string>(
    request: InteractionRequest,
    handlers: QuestionHandlerMap
  ): AsyncIterable<StreamEvent<TCommand>> {
    const { command, payload } = request;
    if (command !== 'chat') {
      throw new Error(`Unsupported stream command: ${command}`);
    }

    const chatPayload = payload as { employeeId?: string; options: ChatOptions };

    const onQuestion = Object.values(handlers).some((handler) => typeof handler === 'function')
      ? async (question: Record<string, unknown>): Promise<unknown> => {
          const kind = question.kind as string | undefined;
          const q = question as unknown;
          switch (kind) {
            case 'confirm':
              return handlers.confirm(q as QuestionConfirmRequest);
            case 'select':
              return handlers.select(q as QuestionSelectRequest);
            case 'password':
              return handlers.password(q as QuestionPasswordRequest);
            case 'checklist':
              return handlers.checklist(q as QuestionChecklistRequest);
            default:
              return handlers.input(q as QuestionInputRequest) ?? '';
          }
        }
      : undefined;

    return streamViaWebSocket(chatPayload.employeeId ?? '', chatPayload.options?.message ?? '', {
      url: this.wsBaseUrl,
      sessionId: chatPayload.options?.sessionId,
      messageOptions: chatPayload.options as Record<string, unknown> | undefined,
      signal: handlers.signal,
      onQuestion,
    }) as AsyncIterable<StreamEvent<TCommand>>;
  }
}
