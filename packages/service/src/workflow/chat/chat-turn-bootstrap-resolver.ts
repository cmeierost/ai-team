import type {
  Agent,
  ChatMessage,
  ChatTurnBootstrapResolution,
  ExecutionContext,
  IAgentManager,
  IChatTurnBootstrapResolver,
  IDeveloperIdentityService,
  ISessionManager,
  IThreadManager,
} from '@ai-team/core';

interface ChatRuntimeWorkflowStateSnapshot {
  agentId: string;
  sessionId: string;
  history: ChatMessage[];
  navStack: ExecutionContext['navStack'];
}

export class ChatTurnBootstrapResolver implements IChatTurnBootstrapResolver {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly sessionManager: ISessionManager,
    private readonly developerIdentityService: IDeveloperIdentityService,
    private readonly threadManager: IThreadManager
  ) {}

  async resolveAsync(
    input: {
      agentQuery?: string;
      sessionId?: string;
      createNewSession?: boolean;
    },
    ctx: ExecutionContext
  ): Promise<ChatTurnBootstrapResolution> {
    const developerName = this.developerIdentityService.getUserName() ?? 'developer';
    const developerId = this.developerIdentityService.toDeveloperId(developerName);
    const cachedState = this.getCachedRuntimeState(ctx);

    const requestedSessionId = input.sessionId ?? ctx.sessionId ?? cachedState?.sessionId;
    let requestedSession = requestedSessionId
      ? await this.resolveRequestedSessionAsync(requestedSessionId, cachedState)
      : null;

    if (requestedSessionId && !requestedSession) {
      return {
        ok: false,
        message: `Session '${requestedSessionId}' not found`,
      };
    }

    if (requestedSession && input.createNewSession !== true) {
      const active = await this.threadManager.resolveActiveSession(requestedSession.id);
      requestedSession = active.session;
      ctx.navStack = [...active.state.navigationStack];
    } else if (
      !requestedSession &&
      input.createNewSession !== true &&
      !input.agentQuery &&
      !ctx.agentId &&
      !ctx.agent?.id
    ) {
      requestedSession = await this.threadManager.resolveLatestActiveSession(developerId);
      if (requestedSession) {
        const active = await this.threadManager.resolveActiveSession(requestedSession.id);
        ctx.navStack = [...active.state.navigationStack];
      }
    }

    const agent = await this.resolveAgentForTurnAsync(
      {
        agentQuery: input.agentQuery ?? ctx.agentId ?? ctx.agent?.id ?? cachedState?.agentId,
        requestedSession,
        developerId,
      },
      ctx
    );

    if (!agent) {
      const query = input.agentQuery ?? ctx.agentId ?? ctx.agent?.id;
      return {
        ok: false,
        message: query
          ? `Unable to resolve agent '${query}' for chat turn`
          : 'Unable to resolve agent for chat turn',
      };
    }

    const session = await this.resolveSessionForTurnAsync(agent, {
      sessionId: requestedSession?.id ?? requestedSessionId,
      createNewSession: input.createNewSession,
      developerId,
      cachedState,
    });

    return {
      ok: true,
      agent,
      sessionId: session.sessionId,
      sessionHistory: session.history,
      developerId,
    };
  }

  updateCachedRuntimeState(
    ctx: ExecutionContext,
    state: {
      agentId: string;
      sessionId: string;
      history: ChatMessage[];
      navStack: ExecutionContext['navStack'];
    }
  ): void {
    if (!ctx.workflowState || typeof ctx.workflowState !== 'object' || Array.isArray(ctx.workflowState)) {
      ctx.workflowState = {};
    }

    const bag = ctx.workflowState as Record<string, unknown>;
    bag['chatRuntime'] = {
      agentId: state.agentId,
      sessionId: state.sessionId,
      history: [...state.history],
      navStack: [...(state.navStack ?? [])],
    } satisfies ChatRuntimeWorkflowStateSnapshot;

    ctx.navStack = [...(state.navStack ?? [])];
  }

  private async resolveRequestedSessionAsync(
    sessionId: string,
    cachedState: ChatRuntimeWorkflowStateSnapshot | null
  ): Promise<Awaited<ReturnType<ISessionManager['getSession']>>> {
    if (cachedState?.sessionId === sessionId) {
      return {
        id: cachedState.sessionId,
        agentId: cachedState.agentId,
      } as unknown as Awaited<ReturnType<ISessionManager['getSession']>>;
    }

    return this.sessionManager.getSession(sessionId);
  }

  private async resolveAgentForTurnAsync(
    input: {
      agentQuery?: string;
      requestedSession: Awaited<ReturnType<ISessionManager['getSession']>>;
      developerId: string;
    },
    ctx: ExecutionContext
  ): Promise<Agent | null> {
    if (ctx.agent?.id && (!input.agentQuery || input.agentQuery === ctx.agent.id)) {
      return ctx.agent;
    }

    if (input.requestedSession?.agentId) {
      const fromSession = await this.agentManager.getAgentAsync(input.requestedSession.agentId);
      if (fromSession) {
        return fromSession;
      }
    }

    const query = input.agentQuery?.trim();
    if (query) {
      const resolved = await this.agentManager.resolveAgentForOperationAsync(
        query,
        'chat direct turn'
      );
      const fromResolved = await this.agentManager.getAgentAsync(resolved.id);
      if (fromResolved) {
        return fromResolved;
      }
      return null;
    }

    const latestResumeSession = await this.sessionManager.resolveLatestSessionForResume(
      input.developerId
    );
    if (!latestResumeSession?.agentId) {
      return null;
    }

    return (await this.agentManager.getAgentAsync(latestResumeSession.agentId)) ?? null;
  }

  private async resolveSessionForTurnAsync(
    agent: Agent,
    options: {
      sessionId?: string;
      createNewSession?: boolean;
      developerId: string;
      cachedState: ChatRuntimeWorkflowStateSnapshot | null;
    }
  ): Promise<{ sessionId: string; history: ChatMessage[] }> {
    if (
      options.cachedState &&
      options.createNewSession !== true &&
      options.sessionId &&
      options.cachedState.sessionId === options.sessionId &&
      options.cachedState.agentId === agent.id
    ) {
      return { sessionId: options.cachedState.sessionId, history: [...options.cachedState.history] };
    }

    if (options.sessionId) {
      const history = await this.sessionManager.getSessionMessages(options.sessionId);
      return { sessionId: options.sessionId, history };
    }

    if (options.createNewSession) {
      const created = await this.sessionManager.createSession(agent.id, options.developerId);
      return { sessionId: created.id, history: [] };
    }

    const latest = await this.sessionManager.getLatestSession(agent.id);
    if (latest) {
      const history = await this.sessionManager.getSessionMessages(latest.id);
      return { sessionId: latest.id, history };
    }

    const created = await this.sessionManager.createSession(agent.id, options.developerId);
    return { sessionId: created.id, history: [] };
  }

  private getCachedRuntimeState(ctx: ExecutionContext): ChatRuntimeWorkflowStateSnapshot | null {
    if (!ctx.workflowState || typeof ctx.workflowState !== 'object' || Array.isArray(ctx.workflowState)) {
      return null;
    }

    const bag = ctx.workflowState as Record<string, unknown>;
    const raw = bag['chatRuntime'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const candidate = raw as Partial<ChatRuntimeWorkflowStateSnapshot>;
    if (
      typeof candidate.agentId !== 'string' ||
      typeof candidate.sessionId !== 'string' ||
      !Array.isArray(candidate.history) ||
      !Array.isArray(candidate.navStack)
    ) {
      return null;
    }

    ctx.navStack = candidate.navStack as ExecutionContext['navStack'];

    return {
      agentId: candidate.agentId,
      sessionId: candidate.sessionId,
      history: candidate.history as ChatMessage[],
      navStack: candidate.navStack as ExecutionContext['navStack'],
    };
  }
}
