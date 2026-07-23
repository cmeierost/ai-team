import { describe, expect, it, vi } from 'vitest';
import { ChatDirectTurnCommand } from './chat-direct-turn.command.js';

function createDeps(overrides: {
  getUserName?: () => string;
  toDeveloperId?: (name: string) => string;
  resolveAgentForOperationAsync?: (query: string, op: string) => Promise<{ id: string }>;
  getAgentAsync?: (id: string) => Promise<any>;
  getSession?: (id: string) => Promise<any>;
  resolveLatestSessionForResume?: (developerId?: string) => Promise<any>;
  getSessionMessages?: (sessionId: string) => Promise<any[]>;
  createSession?: (agentId: string, developerId: string) => Promise<any>;
  getLatestSession?: (agentId: string) => Promise<any>;
}) {
  const agentManager = {
    getAgentAsync: vi.fn(overrides.getAgentAsync ?? (async (_id: string) => undefined)),
    resolveAgentForOperationAsync: vi.fn(
      overrides.resolveAgentForOperationAsync ?? (async (query: string) => ({ id: query }))
    ),
  } as any;

  const sessionManager = {
    getSession: vi.fn(overrides.getSession ?? (async (_id: string) => null)),
    resolveLatestSessionForResume: vi.fn(
      overrides.resolveLatestSessionForResume ?? (async () => null)
    ),
    getSessionMessages: vi.fn(overrides.getSessionMessages ?? (async () => [])),
    createSession: vi.fn(
      overrides.createSession ??
        (async (_agentId: string, _developerId: string) => ({ id: 'new-session' }))
    ),
    getLatestSession: vi.fn(overrides.getLatestSession ?? (async () => null)),
    appendMessage: vi.fn(async () => null),
  } as any;

  const developerIdentityService = {
    getUserName: vi.fn(overrides.getUserName ?? (() => 'Clemens Meier')),
    toDeveloperId: vi.fn(
      overrides.toDeveloperId ?? ((name: string) => name.toLowerCase().replace(/\s+/g, '-'))
    ),
  } as any;

  const stepService = {
    ensureTurnStartAsync: vi.fn(async () => undefined),
    persistUserMessageAsync: vi.fn(async () => undefined),
    prepareMessagesAsync: vi.fn(async () => []),
    resolveSkillsAndToolsAsync: vi.fn(async () => ({ skills: [], tools: [] })),
    invokeTurnLlmAsync: vi.fn(async () => ({
      fullResponse: 'assistant output',
      structuredResults: [],
    })),
    persistAssistantMessageAsync: vi.fn(async () => ({
      persistedMessage: {
        id: 1,
        content: 'assistant output',
      },
      persistedContent: 'assistant output',
    })),
    parseTurnResultAsync: vi.fn(async () => ({ text: 'assistant output', done: false })),
    finalizeTurnResultAsync: vi.fn(async (result: any) => result),
    handleLlmFailureAsync: vi.fn(async () => ({ text: 'fallback', done: true })),
  } as any;

  const emitService = {
    toolEvent: vi.fn(),
  } as any;

  const commandDispatcher = {
    getCommand: vi.fn((key: string) => {
      if (key === 'help') {
        return { key: 'help', group: 'system', aliases: ['h'] };
      }
      return undefined;
    }),
    getCommands: vi.fn(() => [
      { key: 'help', group: 'system', aliases: ['h'], availableIn: { chat: true } },
    ]),
    dispatch: vi.fn(async (_key: string, _payload: unknown, _ctx: unknown) => ({
      status: 'ok',
      message: 'Help output',
      data: 'Help output',
    })),
  } as any;

  const plugins = {
    commandDispatcher,
  } as any;

  const bootstrapResolver = {
    resolveAsync: vi.fn(async (input: any, ctx: any) => {
      const developerName = developerIdentityService.getUserName() ?? 'developer';
      const developerId = developerIdentityService.toDeveloperId(developerName);

      const cached = (ctx?.workflowState as any)?.chatRuntime;
      const requestedSessionId = input.sessionId ?? ctx?.sessionId ?? cached?.sessionId;
      const requestedSession = requestedSessionId
        ? cached?.sessionId === requestedSessionId
          ? ({ id: cached.sessionId, agentId: cached.agentId } as any)
          : await sessionManager.getSession(requestedSessionId)
        : null;

      if (requestedSessionId && !requestedSession) {
        return { ok: false as const, message: `Session '${requestedSessionId}' not found` };
      }

      let agent = ctx?.agent;
      const query = input.agentQuery ?? ctx?.agentId ?? ctx?.agent?.id ?? cached?.agentId;

      if (!agent) {
        if (requestedSession?.agentId) {
          agent = await agentManager.getAgentAsync(requestedSession.agentId);
        }

        if (!agent && query) {
          const resolved = await agentManager.resolveAgentForOperationAsync(
            query,
            'chat direct turn'
          );
          agent = await agentManager.getAgentAsync(resolved.id);
        }

        if (!agent) {
          const latestResumeSession =
            await sessionManager.resolveLatestSessionForResume(developerId);
          if (latestResumeSession?.agentId) {
            agent = await agentManager.getAgentAsync(latestResumeSession.agentId);
          }
        }
      }

      if (!agent) {
        return { ok: false as const, message: 'Unable to resolve agent for chat turn' };
      }

      if (
        cached &&
        requestedSessionId &&
        cached.sessionId === requestedSessionId &&
        cached.agentId === agent.id &&
        input.createNewSession !== true
      ) {
        return {
          ok: true as const,
          agent,
          sessionId: cached.sessionId,
          history: [...cached.history],
        };
      }

      if (input.createNewSession) {
        const created = await sessionManager.createSession(agent.id, developerId);
        return { ok: true as const, agent, sessionId: created.id, history: [] };
      }

      if (requestedSessionId) {
        const history = await sessionManager.getSessionMessages(requestedSessionId);
        return { ok: true as const, agent, sessionId: requestedSessionId, history };
      }

      const latest = await sessionManager.getLatestSession(agent.id);
      if (latest) {
        const history = await sessionManager.getSessionMessages(latest.id);
        return { ok: true as const, agent, sessionId: latest.id, history };
      }

      const created = await sessionManager.createSession(agent.id, developerId);
      return { ok: true as const, agent, sessionId: created.id, history: [] };
    }),
    updateCachedRuntimeState: vi.fn((ctx: any, state: any) => {
      ctx.workflowState = ctx.workflowState ?? {};
      ctx.workflowState.chatRuntime = {
        agentId: state.agentId,
        sessionId: state.sessionId,
        history: [...state.history],
      };
    }),
  };

  const command = new ChatDirectTurnCommand(
    bootstrapResolver as any,
    stepService,
    plugins,
    sessionManager,
    emitService
  );

  return {
    command,
    agentManager,
    sessionManager,
    developerIdentityService,
    stepService,
    bootstrapResolver,
    emitService,
    commandDispatcher,
  };
}

describe('ChatDirectTurnCommand bootstrap', () => {
  it('uses latest session agent when no agent is provided', async () => {
    const { command, sessionManager, agentManager } = createDeps({
      resolveLatestSessionForResume: async () => ({ id: 'sess-latest', agentId: 'sarah-lee' }),
      getAgentAsync: async (id: string) => ({ id, name: 'Sarah Lee', role: 'architect' }),
      getLatestSession: async () => ({ id: 'sess-agent', agentId: 'sarah-lee' }),
      getSessionMessages: async () => [{ content: 'hello history' } as any],
    });

    const response = await command.execute(
      {
        options: { message: 'hello' },
      } as any,
      { history: [] } as any
    );

    expect(response.status).toBe('ok');
    expect(sessionManager.resolveLatestSessionForResume).toHaveBeenCalled();
    expect(agentManager.getAgentAsync).toHaveBeenCalledWith('sarah-lee');
    expect(sessionManager.getSessionMessages).toHaveBeenCalledWith('sess-agent');
  });

  it('uses requested session agent when sessionId is provided', async () => {
    const { command, sessionManager, agentManager } = createDeps({
      getSession: async (id: string) => ({ id, agentId: 'michael-brown' }),
      getAgentAsync: async (id: string) => ({ id, name: 'Michael Brown', role: 'ceo' }),
      getSessionMessages: async () => [],
    });

    const response = await command.execute(
      {
        options: { message: 'hello', sessionId: 'session-123' },
      } as any,
      { history: [] } as any
    );

    expect(response.status).toBe('ok');
    expect(sessionManager.getSession).toHaveBeenCalledWith('session-123');
    expect(agentManager.getAgentAsync).toHaveBeenCalledWith('michael-brown');
    expect(sessionManager.getSessionMessages).toHaveBeenCalledWith('session-123');
  });

  it('creates a new session when createNewSession is true', async () => {
    const { command, sessionManager } = createDeps({
      resolveLatestSessionForResume: async () => ({ id: 'sess-latest', agentId: 'sarah-lee' }),
      getAgentAsync: async (id: string) => ({ id, name: 'Sarah Lee', role: 'architect' }),
      createSession: async () => ({ id: 'new-created-session' }),
      getLatestSession: async () => ({ id: 'older-session', agentId: 'sarah-lee' }),
    } as any);

    const response = await command.execute(
      {
        options: { message: 'hello', createNewSession: true },
      } as any,
      { history: [] } as any
    );

    expect(response.status).toBe('ok');
    expect(sessionManager.createSession).toHaveBeenCalledWith('sarah-lee', 'clemens-meier');
  });

  it('resolves fuzzy/alias agent query via resolveAgentForOperationAsync', async () => {
    const { command, agentManager } = createDeps({
      resolveAgentForOperationAsync: async () => ({ id: 'clara-bishop' }) as any,
      getAgentAsync: async (id: string) => ({ id, name: 'Clara Bishop', role: 'frontend' }),
      getLatestSession: async () => ({ id: 'sess-clara', agentId: 'clara-bishop' }),
      getSessionMessages: async () => [],
    });

    const response = await command.execute(
      {
        agentId: 'clara',
        options: { message: 'hello' },
      } as any,
      { history: [] } as any
    );

    expect(response.status).toBe('ok');
    expect(agentManager.resolveAgentForOperationAsync).toHaveBeenCalledWith(
      'clara',
      'chat direct turn'
    );
  });

  it('reuses cached workflowState history for same session instead of reloading DB', async () => {
    const { command, sessionManager, stepService } = createDeps({
      getAgentAsync: async (id: string) => ({ id, name: 'Sarah Lee', role: 'architect' }),
      getLatestSession: async () => ({ id: 'sess-agent', agentId: 'sarah-lee' }),
      getSessionMessages: async () => [{ content: 'db-history' } as any],
      resolveLatestSessionForResume: async () => ({ id: 'sess-agent', agentId: 'sarah-lee' }),
    });

    const ctx = {
      history: [],
      workflowState: {
        chatRuntime: {
          agentId: 'sarah-lee',
          sessionId: 'sess-agent',
          history: [{ content: 'cached-history' }],
        },
      },
    } as any;

    const response = await command.execute(
      {
        options: { message: 'hello', sessionId: 'sess-agent' },
      } as any,
      ctx
    );

    expect(response.status).toBe('ok');
    expect(sessionManager.getSessionMessages).toHaveBeenCalledTimes(0);
    expect(stepService.prepareMessagesAsync).toHaveBeenCalled();
  });

  it('updates workflowState cache after successful turn', async () => {
    const { command } = createDeps({
      resolveLatestSessionForResume: async () => ({ id: 'sess-latest', agentId: 'sarah-lee' }),
      getAgentAsync: async (id: string) => ({ id, name: 'Sarah Lee', role: 'architect' }),
      getLatestSession: async () => ({ id: 'sess-agent', agentId: 'sarah-lee' }),
      getSessionMessages: async () => [],
    });

    const ctx = { history: [], workflowState: {} } as any;
    const response = await command.execute(
      {
        options: { message: 'hello' },
      } as any,
      ctx
    );

    expect(response.status).toBe('ok');
    expect((ctx.workflowState as any).chatRuntime).toBeDefined();
    expect((ctx.workflowState as any).chatRuntime.agentId).toBe('sarah-lee');
    expect((ctx.workflowState as any).chatRuntime.sessionId).toBe('sess-agent');
    expect(Array.isArray((ctx.workflowState as any).chatRuntime.history)).toBe(true);
  });

  it('uses an internal continuation as transient system context without persisting a human message', async () => {
    const { command, stepService, sessionManager } = createDeps({
      resolveLatestSessionForResume: async () => ({ id: 'sess-latest', agentId: 'michael-brown' }),
      getAgentAsync: async (id: string) => ({ id, name: 'Michael Brown', role: 'ceo' }),
      getLatestSession: async () => ({ id: 'sess-agent', agentId: 'michael-brown' }),
      getSessionMessages: async () => [],
    });

    const response = await command.execute(
      {
        options: {
          message: '[Handoff received] continue naturally',
          messageOrigin: 'internal',
        },
      } as any,
      { history: [] } as any
    );

    expect(response.status).toBe('ok');
    expect(stepService.persistUserMessageAsync).not.toHaveBeenCalled();
    expect(sessionManager.appendMessage).not.toHaveBeenCalled();
    expect(stepService.prepareMessagesAsync).toHaveBeenCalledWith(
      '[Handoff received] continue naturally',
      expect.anything(),
      expect.anything(),
      { internalInstruction: '[Handoff received] continue naturally' }
    );
  });

  it('executes slash command directly without invoking LLM send-turn pipeline', async () => {
    const { command, stepService, sessionManager, emitService, commandDispatcher } = createDeps({
      resolveLatestSessionForResume: async () => ({ id: 'sess-latest', agentId: 'michael-brown' }),
      getAgentAsync: async (id: string) => ({ id, name: 'Michael Brown', role: 'ceo' }),
      getLatestSession: async () => ({ id: 'sess-agent', agentId: 'michael-brown' }),
      getSessionMessages: async () => [],
    });
    commandDispatcher.dispatch.mockImplementationOnce(
      async (_key: string, _args: unknown, ctx: any) => {
        expect(ctx.invocationSurface).toBe('slash');
        expect(ctx.calledByHuman).toBe(true);
        expect(ctx.callerType).toBe('human');
        ctx.sessionId = 'session-after-slash';
        return { status: 'ok', message: 'Help output', data: 'Help output' };
      }
    );

    const outerContext = { history: [], invocationSurface: 'cli', calledByHuman: true } as any;
    const response = await command.execute(
      {
        options: { message: '/help chat' },
      } as any,
      outerContext
    );

    expect(response.status).toBe('ok');
    expect(stepService.persistUserMessageAsync).toHaveBeenCalledTimes(0);
    expect(stepService.invokeTurnLlmAsync).toHaveBeenCalledTimes(0);
    expect(sessionManager.appendMessage).toHaveBeenCalledTimes(1);
    const persisted = sessionManager.appendMessage.mock.calls[0]?.[1] as any;
    expect(persisted.isHuman).toBe(true);
    expect(persisted.hiddenFromLlm).toBe(true);
    expect(persisted.content).toBe('/help chat');
    expect(persisted.tool_calls?.[0]?.tool).toBe('slash:help');
    expect(persisted.tool_calls?.[0]?.params?.invokedBy).toBe('user');
    expect(emitService.toolEvent).toHaveBeenCalled();
    expect(commandDispatcher.dispatch).toHaveBeenCalledWith(
      'system-help',
      'chat',
      expect.anything()
    );
    expect(outerContext.invocationSurface).toBe('cli');
    expect((outerContext.workflowState as any).chatRuntime.sessionId).toBe('session-after-slash');
    expect(response.data).toMatchObject({
      sessionId: 'session-after-slash',
      followUpMessage: expect.any(String),
    });
  });

  it('does not dispatch commands that are unavailable in chat', async () => {
    const { command, commandDispatcher, emitService } = createDeps({
      resolveLatestSessionForResume: async () => ({
        id: 'sess-latest',
        agentId: 'michael-brown',
      }),
      getAgentAsync: async (id: string) => ({
        id,
        name: 'Michael Brown',
        role: 'ceo',
      }),
      getLatestSession: async () => ({
        id: 'sess-agent',
        agentId: 'michael-brown',
      }),
      getSessionMessages: async () => [],
    });
    commandDispatcher.getCommands.mockReturnValue([]);

    const response = await command.execute(
      { options: { message: '/serve' } } as any,
      { history: [] } as any
    );

    expect(response.status).toBe('ok');
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(emitService.toolEvent).toHaveBeenCalledWith(
      'slash:serve',
      undefined,
      'error',
      'Unknown chat command: /serve',
      undefined,
      expect.anything()
    );
  });
});
