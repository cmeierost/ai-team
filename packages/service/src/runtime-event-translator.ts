import type { AiTeamCommandName, RuntimeStreamEvent, StreamEvent } from '@ai-team/api-contracts';

export function runtimeEventToStreamEvent<TCommand extends AiTeamCommandName>(
  event: RuntimeStreamEvent,
  base: { requestId?: string; command: TCommand; timestamp: string }
): StreamEvent<TCommand> | null {
  switch (event.kind) {
    case 'status':
    case 'agent_info':
    case 'progress':
    case 'code_edit_proposal':
      return { ...base, ...event } as StreamEvent<TCommand>;
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
    case 'avatar-preview':
      return { ...base, ...event } as StreamEvent<TCommand>;
    case 'session_switched':
      return { ...base, ...event } as StreamEvent<TCommand>;
    case 'session_title_updated':
      return { ...base, ...event } as StreamEvent<TCommand>;
  }
}
