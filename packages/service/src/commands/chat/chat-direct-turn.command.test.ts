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
  getCommands?: () => any[];
  dispatchSlash?: (key: string, payload: unknown, ctx: any) => Promise<any>;
  appendToolCallRequest?: (sessionId: string, message: any) => Promise<void>;
  appendToolCallResult?: (
    sessionId: string,
    callId: string,
    result: unknown,
    resultLlm: string | undefined,
    phase: string,
    timestamp: string
  ) => Promise<void>;
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
    ...(overrides.appendToolCallRequest
      ? { appendToolCallRequest: vi.fn(overrides.appendToolCallRequest) }
      : {}),
    ...(overrides.appendToolCallResult
      ? { appendToolCallResult: vi.fn(overrides.appendToolCallResult) }
      : {}),
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
        return { key: 'help', group: 'system', aliases: ['help'] };
      }
      return undefined;
    }),
    getCommands: vi.fn(
      overrides.getCommands ?? (() => [
        { key: 'help', group: 'system', aliases: ['help'], availableIn: { chat: true } },
      ])
    ),
    dispatch: vi.fn(
      overrides.dispatchSlash ?? (async (_key: string, _payload: unknown, _ctx: unknown) => ({
        status: 'ok',
        message: 'Help output',
        data: 'Help output',
      }))
    ),
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
          sessionHistory: [...cached.history],
          developerId,
        };
      }

      if (input.createNewSession) {
        const created = await sessionManager.createSession(agent.id, developerId);
        return {
          ok: true as const,
          agent,
          sessionId: created.id,
          sessionHistory: [],
          developerId,
        };
      }

      if (requestedSessionId) {
        const history = await sessionManager.getSessionMessages(requestedSessionId);
        return {
          ok: true as const,
          agent,
          sessionId: requestedSessionId,
          sessionHistory: history,
          developerId,
        };
      }

      const latest = await sessionManager.getLatestSession(agent.id);
      if (latest) {
        const history = await sessionManager.getSessionMessages(latest.id);
        return {
          ok: true as const,
          agent,
          sessionId: latest.id,
          sessionHistory: history,
          developerId,
        };
      }

      const created = await sessionManager.createSession(agent.id, developerId);
      return {
        ok: true as const,
        agent,
        sessionId: created.id,
        sessionHistory: [],
        developerId,
      };
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

  it('does not continue the active workflow after /session new', async () => {
    const appendToolCallRequest = vi.fn(async () => undefined);
    const appendToolCallResult = vi.fn(async () => undefined);
    const { command, bootstrapResolver, sessionManager } = createDeps({
      getSession: async (id: string) => ({ id, agentId: 'sarah-lee' }),
      getCommands: () => [
        { key: 'new', group: 'session', aliases: ['new'], availableIn: { chat: true } },
      ],
      dispatchSlash: async (_key, _payload, ctx) => {
        ctx.sessionId = 'new-session';
        return { status: 'ok', message: 'New session started.', data: 'new-session' };
      },
      appendToolCallRequest,
      appendToolCallResult,
    });

    const response = await command.execute(
      { options: { message: '/session new' } } as any,
      {
        agent: { id: 'sarah-lee' },
        agentId: 'sarah-lee',
        sessionId: 'old-session',
        history: [],
      } as any
    );

    expect(response).toMatchObject({
      status: 'ok',
      data: {
        sessionId: 'new-session',
        text: 'New session started.',
      },
    });
    expect((response.data as any).followUpMessage).toBeUndefined();
    expect(bootstrapResolver.updateCachedRuntimeState).not.toHaveBeenCalled();
    expect(sessionManager.appendToolCallRequest).toHaveBeenCalledWith('old-session', expect.anything());
    expect(sessionManager.appendToolCallResult).toHaveBeenCalledWith(
      'old-session',
      expect.any(String),
      expect.anything(),
      expect.any(String),
      'result',
      expect.any(String)
    );
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
      expect.anything()
    );
  });

  it('continues in the tool-applied handoff session without scheduling a second transition', async () => {
    const { command, stepService } = createDeps({
      resolveLatestSessionForResume: async () => ({
        id: 'session-michael',
        agentId: 'michael-brown',
      }),
      getAgentAsync: async (id: string) => ({
        id,
        name: id === 'michael-brown' ? 'Michael Brown' : 'Emily Davis',
        role: 'assistant',
      }),
      getLatestSession: async () => ({
        id: 'session-michael',
        agentId: 'michael-brown',
      }),
      getSessionMessages: async () => [],
    });
    stepService.invokeTurnLlmAsync.mockImplementation(
      async (_messages: unknown, _resolved: unknown, ctx: any) => {
        ctx.agent = { id: 'emily-davis', name: 'Emily Davis', role: 'HR Director' };
        ctx.agentId = 'emily-davis';
        ctx.sessionId = 'session-emily';
        ctx.history = [];
        return {
          fullResponse: 'The handoff tool completed.',
          structuredResults: [
            {
              type: 'handoff',
              targetAgentId: 'emily-davis',
              targetSessionId: 'session-emily',
            },
          ],
        };
      }
    );

    const response = await command.execute(
      { options: { message: 'Let me talk to Emily.' } } as any,
      { history: [] } as any
    );

    expect(response).toMatchObject({
      status: 'ok',
      data: {
        agentId: 'emily-davis',
        sessionId: 'session-emily',
        followUpMessage: expect.any(String),
      },
    });
    expect(stepService.persistUserMessageAsync).toHaveBeenCalledOnce();
    expect(stepService.persistAssistantMessageAsync).not.toHaveBeenCalled();
    expect(stepService.parseTurnResultAsync).not.toHaveBeenCalled();
  });

  it('does not persist the source agent text emitted alongside a handoff request', async () => {
    const { command, stepService } = createDeps({
      getAgentAsync: async (id: string) => ({ id, name: 'Sarah Lee', role: 'chief-architect' }),
      getLatestSession: async () => ({ id: 'session-sarah', agentId: 'sarah-lee' }),
      getSessionMessages: async () => [],
    });
    stepService.invokeTurnLlmAsync.mockResolvedValueOnce({
      fullResponse: "I've transferred you to Alex Morgan. They'll take it from here.",
      structuredResults: [{ type: 'handoff', targetAgentId: 'alex-morgan' }],
    });
    stepService.parseTurnResultAsync.mockResolvedValueOnce({
      text: '',
      done: false,
      handedOff: true,
      handoffTargetId: 'alex-morgan',
      handoffNote: 'CLI discussion',
    });

    const response = await command.execute(
      { agentId: 'sarah-lee', options: { message: 'Talk to the CLI owner.' } } as any,
      { history: [] } as any
    );

    expect(stepService.persistAssistantMessageAsync).not.toHaveBeenCalled();
    expect(response.data).toMatchObject({
      text: '',
      handoffTargetId: 'alex-morgan',
    });
  });

  it('retries one empty provider response for an automatic receiving-agent turn', async () => {
    const { command, stepService } = createDeps({
      getAgentAsync: async (id: string) => ({ id, name: 'Alex Morgan', role: 'backend-lead' }),
      getLatestSession: async () => ({ id: 'session-alex', agentId: 'alex-morgan' }),
      getSessionMessages: async () => [],
    });
    stepService.invokeTurnLlmAsync
      .mockRejectedValueOnce(new Error('LLM returned an empty response'))
      .mockResolvedValueOnce({ fullResponse: 'I own the CLI surface. What would you like to discuss?', structuredResults: [] });

    const response = await command.execute(
      {
        agentId: 'alex-morgan',
        options: { message: '[Handoff received]', messageOrigin: 'internal' },
      } as any,
      { history: [] } as any
    );

    expect(stepService.invokeTurnLlmAsync).toHaveBeenCalledTimes(2);
    expect(stepService.persistAssistantMessageAsync).toHaveBeenCalledWith(
      'I own the CLI surface. What would you like to discuss?',
      expect.anything()
    );
    expect(response.data).toMatchObject({ text: 'assistant output' });
  });

  it('routes and persists every later developer turn to the cached handoff target', async () => {
    const { command, stepService } = createDeps({
      resolveLatestSessionForResume: async () => ({
        id: 'session-michael',
        agentId: 'michael-brown',
      }),
      getAgentAsync: async (id: string) => ({
        id,
        name: id === 'michael-brown' ? 'Michael Brown' : 'Emily Davis',
        role: 'assistant',
      }),
      getLatestSession: async () => ({
        id: 'session-michael',
        agentId: 'michael-brown',
      }),
      getSessionMessages: async () => [],
    });
    let invocation = 0;
    stepService.invokeTurnLlmAsync.mockImplementation(
      async (_messages: unknown, _resolved: unknown, turnCtx: any) => {
        invocation += 1;
        if (invocation === 1) {
          turnCtx.agent = { id: 'emily-davis', name: 'Emily Davis', role: 'HR Director' };
          turnCtx.agentId = 'emily-davis';
          turnCtx.sessionId = 'session-emily';
          turnCtx.history = [];
          return { fullResponse: 'handoff completed', structuredResults: [] };
        }
        expect(turnCtx.agent.id).toBe('emily-davis');
        expect(turnCtx.sessionId).toBe('session-emily');
        return { fullResponse: 'Emily continues.', structuredResults: [] };
      }
    );
    const outerContext = { history: [], workflowState: {} } as any;

    await command.execute({ options: { message: 'Let me talk to Emily.' } } as any, outerContext);
    const second = await command.execute(
      { options: { message: 'Here is the next request.' } } as any,
      outerContext
    );

    expect(second).toMatchObject({
      status: 'ok',
      data: {
        text: 'assistant output',
        agentId: 'emily-davis',
        sessionId: 'session-emily',
      },
    });
    expect(stepService.persistUserMessageAsync).toHaveBeenCalledTimes(2);
    expect(stepService.persistUserMessageAsync.mock.calls[1][1]).toMatchObject({
      agent: { id: 'emily-davis' },
      sessionId: 'session-emily',
    });
    expect(stepService.persistAssistantMessageAsync).toHaveBeenCalledOnce();
    expect(stepService.persistAssistantMessageAsync.mock.calls[0][1]).toMatchObject({
      agent: { id: 'emily-davis' },
      sessionId: 'session-emily',
    });
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
    expect(emitService.toolEvent.mock.calls[0]?.[5]).toMatchObject({
      request: persisted.tool_calls[0].params,
    });
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

  it('projects a slash handoff through the same applied transition contract', async () => {
    const { command, commandDispatcher, stepService } = createDeps({
      resolveLatestSessionForResume: async () => ({
        id: 'session-michael',
        agentId: 'michael-brown',
      }),
      getAgentAsync: async (id: string) => ({
        id,
        name: id === 'michael-brown' ? 'Michael Brown' : 'Emily Davis',
        role: 'assistant',
      }),
      getLatestSession: async () => ({
        id: 'session-michael',
        agentId: 'michael-brown',
      }),
      getSessionMessages: async () => [],
    });
    commandDispatcher.getCommands.mockReturnValue([
      {
        key: 'handoff',
        group: 'com',
        aliases: ['ho'],
        availableIn: { chat: true },
      },
    ]);
    let invocationAtDispatch: Record<string, unknown> | undefined;
    commandDispatcher.dispatch.mockImplementation(
      async (_key: string, _args: unknown, ctx: any) => {
        invocationAtDispatch = {
          invocationSurface: ctx.invocationSurface,
          calledByHuman: ctx.calledByHuman,
        };
        ctx.agent = { id: 'emily-davis', name: 'Emily Davis', role: 'HR Director' };
        ctx.agentId = 'emily-davis';
        ctx.sessionId = 'session-emily';
        ctx.history = [];
        return {
          status: 'ok',
          data: {
            type: 'handoff',
            targetAgentId: 'emily-davis',
            targetSessionId: 'session-emily',
          },
        };
      }
    );

    const response = await command.execute(
      { options: { message: '/com handoff emily' } } as any,
      { history: [] } as any
    );

    expect(response).toMatchObject({
      status: 'ok',
      data: {
        agentId: 'emily-davis',
        sessionId: 'session-emily',
        followUpMessage: expect.any(String),
      },
    });
    expect(commandDispatcher.dispatch).toHaveBeenCalledWith(
      'com-handoff',
      'emily',
      expect.anything()
    );
    expect(invocationAtDispatch).toEqual({
      invocationSurface: 'slash',
      calledByHuman: true,
    });
    expect(stepService.invokeTurnLlmAsync).not.toHaveBeenCalled();
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
      expect.any(String),
      'error',
      'Unknown chat command: /serve',
      undefined,
      expect.anything()
    );
  });
});
