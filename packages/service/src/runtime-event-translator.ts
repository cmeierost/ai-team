import type { RuntimeStreamEvent, StreamEvent } from '@ai-team/api-contracts';

export function runtimeEventToStreamEvent<TCommand extends string = string>(
  event: RuntimeStreamEvent,
  base: { requestId?: string; command: TCommand; timestamp: string }
): StreamEvent<TCommand> | null {
  const passthroughEvent = () => ({ ...base, ...event }) as StreamEvent<TCommand>;

  switch (event.kind) {
    case 'log':
      return { ...base, ...event, message: event.message ?? '' } as StreamEvent<TCommand>;
    case 'token':
      return event.text !== undefined
        ? ({ ...base, ...event, text: event.text } as StreamEvent<TCommand>)
        : null;
    case 'tool':
      return event.toolName
        ? ({ ...base, ...event, toolName: event.toolName } as StreamEvent<TCommand>)
        : null;
    case 'question':
      return event.message
        ? ({ ...base, ...event, message: event.message } as StreamEvent<TCommand>)
        : null;
    case 'handoff':
      return event.fromAgentId && event.toAgentId
        ? ({
            ...base,
            ...event,
            fromAgentId: event.fromAgentId,
            toAgentId: event.toAgentId,
          } as StreamEvent<TCommand>)
        : null;
    default:
      return passthroughEvent();
  }
}
