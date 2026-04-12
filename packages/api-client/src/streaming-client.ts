import type {
  AiTeamCommandName,
  AiTeamCommandResponseMap,
  MediatorRequest,
  MediatorEvent,
  MediatorContext,
  IAiTeamMediator,
} from './contract/routers/streaming.js';
import { type WebSocketStreamOptions, streamViaWebSocket } from './websocket.js';

// ─── Factory ──────────────────────────────────────────────────────────────────

export class StreamingClient implements IAiTeamMediator {
  private readonly wsBaseUrl: string;
  constructor(baseUrl: string, wsUrl: string) {
    this.wsBaseUrl = wsUrl ?? baseUrl.replace(/^http/, 'ws');
  }

  streamChat<TCommand extends AiTeamCommandName>(
    agentId: string,
    message: string,
    options: Omit<WebSocketStreamOptions, 'url'> & { sessionId?: string }
  ): AsyncIterable<MediatorEvent<TCommand>> {
    return streamViaWebSocket<TCommand>(agentId, message, { ...options, url: this.wsBaseUrl });
  }

  invokeTool<TCommand extends AiTeamCommandName>(
    _request: MediatorRequest<TCommand>,
    _context?: MediatorContext
  ): Promise<AiTeamCommandResponseMap[TCommand]> {
    throw new Error('invokeTool is not supported by StreamingClient');
  }

  streamInteraction<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context?: MediatorContext
  ): AsyncIterable<MediatorEvent<TCommand>> {
    const { command, payload } = request;
    if (command === 'chat') {
      const { employeeId, options: chatOpts } = (payload ?? {}) as any;
      const onQuestion = context
        ? async (question: Record<string, unknown>): Promise<unknown> => {
            const kind = question.kind as string | undefined;
            switch (kind) {
              case 'confirm':
                return context.questionConfirm?.(question as any) ?? false;
              case 'select':
                return context.questionSelect?.(question as any) ?? '';
              case 'password':
                return context.questionPassword?.(question as any) ?? '';
              case 'checklist':
                return context.questionChecklist?.(question as any) ?? [];
              default:
                return context.questionInput?.(question as any) ?? '';
            }
          }
        : undefined;
      return streamViaWebSocket(employeeId, chatOpts?.message ?? '', {
        url: this.wsBaseUrl,
        sessionId: chatOpts?.sessionId,
        messageOptions: chatOpts,
        signal: context?.signal,
        onQuestion,
      }) as AsyncIterable<MediatorEvent<TCommand>>;
    }
    throw new Error(`Unsupported stream command: ${command}`);
  }
}
