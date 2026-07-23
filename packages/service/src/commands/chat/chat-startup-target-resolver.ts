import type {
  Agent,
  IAgentManager,
  IDeveloperIdentityService,
  IThreadManager,
} from '@ai-team/core';

export interface ChatStartupTarget {
  agent: Agent;
  sessionId?: string;
}

/**
 * Resolves CLI/API startup selection inside the service boundary.
 * Adapters pass user intent only; thread cursor traversal remains shared.
 */
export class ChatStartupTargetResolver {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly threadManager: IThreadManager,
    private readonly developerIdentityService: IDeveloperIdentityService
  ) {}

  async resolve(input: {
    agentQuery?: string;
    sessionId?: string;
    createNewSession?: boolean;
  }): Promise<ChatStartupTarget | null> {
    let sessionId = input.sessionId;
    let agentQuery = input.agentQuery?.trim() || undefined;

    if (sessionId && input.createNewSession !== true) {
      const active = await this.threadManager.resolveActiveSession(sessionId);
      if (!active.session) return null;
      sessionId = active.session.id;
      agentQuery = active.session.agentId;
    } else if (!agentQuery && input.createNewSession !== true) {
      const developerName = this.developerIdentityService.getUserName() || 'developer';
      const developerId = this.developerIdentityService.toDeveloperId(developerName);
      const latest = await this.threadManager.resolveLatestActiveSession(developerId);
      if (!latest) return null;
      sessionId = latest.id;
      agentQuery = latest.agentId;
    }

    if (!agentQuery) return null;
    const resolved = await this.agentManager.resolveAgentForOperationAsync(
      agentQuery,
      'chat startup'
    );
    const agent = await this.agentManager.getAgentAsync(resolved.id);
    return agent ? { agent, sessionId } : null;
  }
}
