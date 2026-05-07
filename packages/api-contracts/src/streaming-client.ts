import type {
  InteractionRequest,
  StreamEvent,
  IStreamingClient,
  IInteractionStream,
  QuestionHandlerMap,
  QuestionConfirmRequest,
  QuestionSelectRequest,
  QuestionPasswordRequest,
  QuestionChecklistRequest,
  QuestionInputRequest,
  ChatOptions,
} from './contract/routers/streaming.js';
import { InteractionStream } from './interaction-stream.js';
import { streamViaWebSocket } from './websocket.js';

// ─── Factory ──────────────────────────────────────────────────────────────────

export class StreamingClient implements IStreamingClient {
  private readonly wsBaseUrl: string;
  constructor(baseUrl: string, wsUrl: string) {
    this.wsBaseUrl = wsUrl ?? baseUrl.replace(/^http/, 'ws');
  }

  stream<TCommand extends string = string>(
    request: InteractionRequest,
    options?: { signal?: AbortSignal } & Partial<QuestionHandlerMap>
  ): IInteractionStream<TCommand> {
    const { command, payload } = request;
    if (command !== 'chat') {
      throw new Error(`Unsupported stream command: ${command}`);
    }

    const chatPayload = payload as { employeeId?: string; options: ChatOptions };
    const wsBaseUrl = this.wsBaseUrl;

    return new InteractionStream<TCommand>((handlers) => {
      const effectiveHandlers = {
        questionInput: handlers.questionInput ?? options?.questionInput,
        questionConfirm: handlers.questionConfirm ?? options?.questionConfirm,
        questionSelect: handlers.questionSelect ?? options?.questionSelect,
        questionPassword: handlers.questionPassword ?? options?.questionPassword,
        questionChecklist: handlers.questionChecklist ?? options?.questionChecklist,
      };

      const onQuestion = Object.values(effectiveHandlers).some(
        (handler) => typeof handler === 'function'
      )
        ? async (question: Record<string, unknown>): Promise<unknown> => {
            const kind = question.kind as string | undefined;
            const q = question as unknown;
            switch (kind) {
              case 'confirm':
                return effectiveHandlers.questionConfirm?.(q as QuestionConfirmRequest) ?? false;
              case 'select':
                return effectiveHandlers.questionSelect?.(q as QuestionSelectRequest) ?? '';
              case 'password':
                return effectiveHandlers.questionPassword?.(q as QuestionPasswordRequest) ?? '';
              case 'checklist':
                return effectiveHandlers.questionChecklist?.(q as QuestionChecklistRequest) ?? [];
              default:
                return effectiveHandlers.questionInput?.(q as QuestionInputRequest) ?? '';
            }
          }
        : undefined;

      return streamViaWebSocket(chatPayload.employeeId ?? '', chatPayload.options?.message ?? '', {
        url: wsBaseUrl,
        sessionId: chatPayload.options?.sessionId,
        messageOptions: chatPayload.options as Record<string, unknown> | undefined,
        signal: options?.signal,
        onQuestion,
      }) as AsyncIterable<StreamEvent<TCommand>>;
    });
  }
}
