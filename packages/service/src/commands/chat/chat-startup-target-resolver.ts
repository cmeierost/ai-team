import type {
  Agent,
  IAgentManager,
  IDeveloperIdentityService,
  IThreadManager,
} from '@ai-team/core';

export interface ChatStartupTarget {
  agent: Agent;
  sessionId?: string;
  createNewSession: boolean;
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
    let createNewSession = input.createNewSession === true;

    if (sessionId && input.createNewSession !== true) {
      const active = await this.threadManager.resolveActiveSession(sessionId);
      if (!active.session) return null;
      sessionId = active.session.id;
      agentQuery = active.session.agentId;
    } else if (!agentQuery && input.createNewSession !== true) {
      const developerName = this.developerIdentityService.getUserName() || 'developer';
      const developerId = this.developerIdentityService.toDeveloperId(developerName);
      const latest = await this.threadManager.resolveLatestSessionWithActivity(developerId);
      if (latest) {
        sessionId = latest.id;
        agentQuery = latest.agentId;
      } else {
        // A first-time bare `ait chat` has no thread cursor yet. Start at the
        // workspace's top-level CEO instead of returning an empty target.
        const ceos = await this.agentManager.getAgentsByRoleAsync('ceo');
        const ceo = ceos[0];
        if (!ceo) return null;
        agentQuery = ceo.id;
        createNewSession = true;
      }
    }

    if (!agentQuery) return null;
    const resolved = await this.agentManager.resolveAgentForOperationAsync(
      agentQuery,
      'chat startup'
    );
    const agent = await this.agentManager.getAgentAsync(resolved.id);
    return agent
      ? {
          agent,
          sessionId,
          createNewSession: createNewSession || Boolean(agentQuery && !sessionId),
        }
      : null;
  }
}
