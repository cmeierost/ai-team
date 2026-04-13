import type {
  AiTeamCommandName,
  AiTeamCommandPayloadMap,
  InteractionRequest,
  StreamEvent,
  IStreamingClient,
  IInteractionStream,
  QuestionConfirmRequest,
  QuestionSelectRequest,
  QuestionPasswordRequest,
  QuestionChecklistRequest,
  QuestionInputRequest,
} from './contract/routers/streaming.js';
import { InteractionStream } from './interaction-stream.js';
import { streamViaWebSocket } from './websocket.js';

// ─── Factory ──────────────────────────────────────────────────────────────────

export class StreamingClient implements IStreamingClient {
  private readonly wsBaseUrl: string;
  constructor(baseUrl: string, wsUrl: string) {
    this.wsBaseUrl = wsUrl ?? baseUrl.replace(/^http/, 'ws');
  }

  stream<TCommand extends AiTeamCommandName>(
    request: InteractionRequest<TCommand>,
    options?: { signal?: AbortSignal }
  ): IInteractionStream<TCommand> {
    const { command, payload } = request;
    if (command !== 'chat') {
      throw new Error(`Unsupported stream command: ${command}`);
    }

    const chatPayload = payload as AiTeamCommandPayloadMap['chat'];
    const wsBaseUrl = this.wsBaseUrl;

    return new InteractionStream<TCommand>((handlers) => {
      const onQuestion =
        Object.keys(handlers).length > 0
          ? async (question: Record<string, unknown>): Promise<unknown> => {
              const kind = question.kind as string | undefined;
              const q = question as unknown;
              switch (kind) {
                case 'confirm':
                  return handlers.questionConfirm?.(q as QuestionConfirmRequest) ?? false;
                case 'select':
                  return handlers.questionSelect?.(q as QuestionSelectRequest) ?? '';
                case 'password':
                  return handlers.questionPassword?.(q as QuestionPasswordRequest) ?? '';
                case 'checklist':
                  return handlers.questionChecklist?.(q as QuestionChecklistRequest) ?? [];
                default:
                  return handlers.questionInput?.(q as QuestionInputRequest) ?? '';
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
