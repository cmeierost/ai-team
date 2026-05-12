import type { ICommand, CommandResponse, ChatMessage, ChatSession } from '@ai-team/core';
import type { SessionManager } from '../../session-manager.js';

export interface AgentSessionResult {
  session: ChatSession;
  history: ChatMessage[];
}

export class FindAgentSessionCommand
  implements ICommand<{ agentId: string; developerId: string }, AgentSessionResult>
{
  readonly key = 'find-agent-session';
  readonly description = 'Find or create the latest session for a given agent';
  readonly availableIn = { chat: false, tool: false };
  readonly group = 'internal';

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
