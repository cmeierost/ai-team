import type {
  ICommand,
  CommandResponse,
  ChatMessage,
  ChatSession,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';

export interface AgentSessionResult {
  session: ChatSession;
  history: ChatMessage[];
}
export const FindAgentSessionCommandMetadata = {
  key: 'find-agent-session',
  description: 'Find or create the latest session for a given agent',
  availableIn: { chat: false, tool: false },
  group: 'internal',
} satisfies ICommandDescriptor;

export class FindAgentSessionCommand implements ICommand<
  { agentId: string; developerId: string },
  AgentSessionResult
> {
  readonly metadata = FindAgentSessionCommandMetadata;

  constructor(
    private readonly sessionManager: Pick<
      SessionManager,
      'getOrCreateLatestSession' | 'getSessionMessages'
    >
  ) {}

  async execute(params: {
    agentId: string;
    developerId: string;
  }): Promise<CommandResponse<AgentSessionResult>> {
    const session = await this.sessionManager.getOrCreateLatestSession(
      params.agentId,
      params.developerId
    );
    const history = await this.sessionManager.getSessionMessages(session.id);
    return { status: 'ok', message: session.id, data: { session, history } };
  }
}
