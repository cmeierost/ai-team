import type {
  AiTeamCommandName,
  MediatorRuntimeEvent,
  MediatorEvent,
} from '@ai-team/api-client';

export function runtimeEventToStreamEvent<TCommand extends AiTeamCommandName>(
  event: MediatorRuntimeEvent,
  base: { requestId?: string; command: TCommand; timestamp: string }
): MediatorEvent<TCommand> | null {
  switch (event.kind) {
    case 'status':
    case 'agent_info':
    case 'progress':
    case 'code_edit_proposal':
      return { ...base, ...event } as MediatorEvent<TCommand>;
    case 'log':
      return { ...base, ...event, message: event.message ?? '' } as MediatorEvent<TCommand>;
    case 'token':
      return event.text !== undefined
        ? ({ ...base, ...event, text: event.text } as MediatorEvent<TCommand>)
        : null;
    case 'tool':
      return event.toolName
        ? ({ ...base, ...event, toolName: event.toolName } as MediatorEvent<TCommand>)
        : null;
    case 'question':
      return event.message
        ? ({ ...base, ...event, message: event.message } as MediatorEvent<TCommand>)
        : null;
    case 'handoff':
      return event.fromAgentId && event.toAgentId
        ? ({
            ...base,
            ...event,
            fromAgentId: event.fromAgentId,
            toAgentId: event.toAgentId,
          } as MediatorEvent<TCommand>)
        : null;
  }
}
