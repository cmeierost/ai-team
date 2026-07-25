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
  resolveActiveInteraction?: (sessionId: string) => Promise<any>;
  dispatchChatTurn?: (sessionId: string, message: string, cursor?: string) => Promise<any>;
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
    resolveSkillsAndToolsAsync: vi.fn(async () => ({
      skills: [],
      teamRoster: [],
      allTools: [],
      toolDefs: [],
    })),
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
      overrides.getCommands ??
        (() => [{ key: 'help', group: 'system', aliases: ['help'], availableIn: { chat: true } }])
    ),
    dispatch: vi.fn(
      overrides.dispatchSlash ??
        (async (_key: string, _payload: unknown, _ctx: unknown) => ({
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

      const requestedSessionId = input.sessionId ?? ctx?.sessionId;
      const requestedSession = requestedSessionId
        ? await sessionManager.getSession(requestedSessionId)
        : null;

      if (requestedSessionId && !requestedSession) {
        return { ok: false as const, message: `Session '${requestedSessionId}' not found` };
      }

      let agent = ctx?.agent;
      const query = input.agentQuery ?? ctx?.agentId ?? ctx?.agent?.id;

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
      ctx.navStack = [...(state.navStack ?? [])];
    }),
  };

  const command = new ChatDirectTurnCommand(
    bootstrapResolver as any,
    stepService,
    plugins,
    sessionManager,
    emitService,
    {
      resolveActiveInteraction: vi.fn(
        overrides.resolveActiveInteraction ?? (async () => null)
      ),
      dispatchChatTurn: vi.fn(
        overrides.dispatchChatTurn ?? (async () => null)
      ),
    } as any
  );
  const workflowInteractions = (command as any).workflowInteractions;

  return {
    command,
    agentManager,
    sessionManager,
    developerIdentityService,
    stepService,
    bootstrapResolver,
    emitService,
    commandDispatcher,
    workflowInteractions,
  };
}

describe('ChatDirectTurnCommand bootstrap', () => {
  it('adds workflow instructions as a system message and limits exposed tools', async () => {
    const { command, stepService } = createDeps({
      resolveLatestSessionForResume: async () => ({
        id: 'sess-latest',
        agentId: 'elena-rostova',
      }),
      getAgentAsync: async (id: string) => ({ id, name: 'Elena Rostova', role: 'ceo' }),
      getLatestSession: async () => ({ id: 'sess-latest', agentId: 'elena-rostova' }),
    });
    stepService.resolveSkillsAndToolsAsync.mockResolvedValue({
      skills: [],
      teamRoster: [],
      allTools: [],
      toolDefs: [
        { name: 'com_ask', description: 'Ask' },
        { name: 'fs_read', description: 'Read files' },
      ],
    });

    await command.execute(
      {
        options: {
          message: 'We build tools for small teams.',
          workflowSystemPrompt: 'Stay in business discovery mode.',
          workflowToolAllowlist: ['com_ask'],
        },
      } as any,
      { history: [] } as any
    );

    expect(stepService.invokeTurnLlmAsync).toHaveBeenCalledWith(
      [
        {
          role: 'system',
          content: 'Stay in business discovery mode.',
        },
      ],
      expect.objectContaining({
        toolDefs: [{ name: 'com_ask', description: 'Ask' }],
      }),
      expect.anything()
    );
  });

  it('routes a normal chat turn through the active workflow interaction cursor', async () => {
    const { command, stepService, workflowInteractions, sessionManager } = createDeps({
      resolveLatestSessionForResume: async () => ({
        id: 'sess-latest',
        agentId: 'elena-rostova',
      }),
      getAgentAsync: async (id: string) => ({ id, name: 'Elena Rostova', role: 'ceo' }),
      getLatestSession: async () => ({ id: 'sess-latest', agentId: 'elena-rostova' }),
      getSessionMessages: async () => [
        { content: 'prior' } as any,
        { content: 'Workflow child reply', isHuman: false } as any,
      ],
      resolveActiveInteraction: async () => ({
        runId: 'workflow:1',
        sessionId: 'sess-latest',
        actorPath: 'workflowChatInvocation_business',
        cursor: 'workflow:1:workflowChatInvocation_business',
      }),
      dispatchChatTurn: async () => ({ assistantMessage: 'Workflow child reply' }),
    });

    const response = await command.execute(
      {
        options: {
          message: 'Please refine the business scope.',
        },
      } as any,
      { history: [] } as any
    );

    expect(response).toMatchObject({
      status: 'ok',
      data: {
        text: 'Workflow child reply',
        sessionId: 'sess-latest',
      },
    });
    expect(workflowInteractions.resolveActiveInteraction).toHaveBeenCalledWith('sess-latest');
    expect(workflowInteractions.dispatchChatTurn).toHaveBeenCalledWith(
      'sess-latest',
      'Please refine the business scope.',
      'workflow:1:workflowChatInvocation_business'
    );
    expect(sessionManager.getSessionMessages).toHaveBeenCalledWith('sess-latest');
    expect(stepService.ensureTurnStartAsync).not.toHaveBeenCalled();
    expect(stepService.invokeTurnLlmAsync).not.toHaveBeenCalled();
  });

  it('re-resolves and retries routed chat turn once when the cursor changed concurrently', async () => {
    const resolveActiveInteraction = vi
      .fn()
      .mockResolvedValueOnce({
        runId: 'workflow:1',
        sessionId: 'sess-latest',
        actorPath: 'workflowChatInvocation_business',
        cursor: 'workflow:1:workflowChatInvocation_old',
      })
      .mockResolvedValueOnce({
        runId: 'workflow:1',
        sessionId: 'sess-latest',
        actorPath: 'workflowChatInvocation_business',
        cursor: 'workflow:1:workflowChatInvocation_new',
      });
    const dispatchChatTurn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Workflow interaction cursor mismatch for session 'sess-latest': expected 'workflow:1:workflowChatInvocation_old', current 'workflow:1:workflowChatInvocation_new'."
        )
      )
      .mockResolvedValueOnce({ assistantMessage: 'Recovered response' });
    const { command, workflowInteractions } = createDeps({
      resolveLatestSessionForResume: async () => ({
        id: 'sess-latest',
        agentId: 'elena-rostova',
      }),
      getAgentAsync: async (id: string) => ({ id, name: 'Elena Rostova', role: 'ceo' }),
      getLatestSession: async () => ({ id: 'sess-latest', agentId: 'elena-rostova' }),
      resolveActiveInteraction,
      dispatchChatTurn,
    });

    const response = await command.execute(
      {
        options: {
          message: 'Continue with latest cursor.',
        },
      } as any,
      { history: [] } as any
    );

    expect(response).toMatchObject({
      status: 'ok',
      data: {
        text: 'Recovered response',
        sessionId: 'sess-latest',
      },
    });
    expect(workflowInteractions.resolveActiveInteraction).toHaveBeenCalledTimes(2);
    expect(workflowInteractions.dispatchChatTurn).toHaveBeenNthCalledWith(
      1,
      'sess-latest',
      'Continue with latest cursor.',
      'workflow:1:workflowChatInvocation_old'
    );
    expect(workflowInteractions.dispatchChatTurn).toHaveBeenNthCalledWith(
      2,
      'sess-latest',
      'Continue with latest cursor.',
      'workflow:1:workflowChatInvocation_new'
    );
  });

  it('bypasses workflow interaction routing when explicitly requested', async () => {
    const { command, stepService } = createDeps({
      resolveLatestSessionForResume: async () => ({
        id: 'sess-latest',
        agentId: 'elena-rostova',
      }),
      getAgentAsync: async (id: string) => ({ id, name: 'Elena Rostova', role: 'ceo' }),
      getLatestSession: async () => ({ id: 'sess-latest', agentId: 'elena-rostova' }),
      resolveActiveInteraction: async () => ({
        runId: 'workflow:1',
        sessionId: 'sess-latest',
        actorPath: 'workflowChatInvocation_business',
        cursor: 'workflow:1:workflowChatInvocation_business',
      }),
    });

    await command.execute(
      {
        options: {
          message: 'Continue.',
          skipWorkflowInteractionRouting: true,
        },
      } as any,
      { history: [] } as any
    );

    expect(stepService.ensureTurnStartAsync).toHaveBeenCalledTimes(1);
    expect(stepService.invokeTurnLlmAsync).toHaveBeenCalledTimes(1);
  });

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
    expect(sessionManager.appendToolCallRequest).toHaveBeenCalledWith(
      'old-session',
      expect.anything()
    );
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

  it('loads session history from persistence for explicit session turns', async () => {
    const { command, sessionManager, stepService } = createDeps({
      getSession: async (id: string) => ({ id, agentId: 'sarah-lee' }),
      getAgentAsync: async (id: string) => ({ id, name: 'Sarah Lee', role: 'architect' }),
      getSessionMessages: async () => [{ content: 'db-history' } as any],
    });

    const response = await command.execute(
      {
        options: { message: 'hello', sessionId: 'sess-agent' },
      } as any,
      { history: [] } as any
    );

    expect(response.status).toBe('ok');
    expect(sessionManager.getSessionMessages).toHaveBeenCalledWith('sess-agent');
    expect(stepService.prepareMessagesAsync).toHaveBeenCalled();
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
      getSession: async (id: string) =>
        id === 'session-emily'
          ? { id: 'session-emily', agentId: 'emily-davis' }
          : id === 'session-michael'
            ? { id: 'session-michael', agentId: 'michael-brown' }
            : null,
      getAgentAsync: async (id: string) => ({
        id,
        name: id === 'michael-brown' ? 'Michael Brown' : 'Emily Davis',
        role: 'assistant',
      }),
      getLatestSession: async (agentId: string) =>
        agentId === 'emily-davis'
          ? {
              id: 'session-emily',
              agentId: 'emily-davis',
            }
          : {
              id: 'session-michael',
              agentId: 'michael-brown',
            },
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
      .mockResolvedValueOnce({
        fullResponse: 'I own the CLI surface. What would you like to discuss?',
        structuredResults: [],
      });

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
    expect(persisted.tool_calls?.[0]?.params).toMatchObject({
      group: 'system',
      key: 'help',
    });
    expect(emitService.toolEvent).toHaveBeenCalled();
    expect(emitService.toolEvent.mock.calls[0]?.[5]).toMatchObject({
      request: persisted.tool_calls[0].params,
      commandGroup: 'system',
      commandKey: 'help',
    });
    expect(commandDispatcher.dispatch).toHaveBeenCalledWith(
      'system-help',
      'chat',
      expect.anything()
    );
    expect(outerContext.invocationSurface).toBe('cli');
    expect(response.data).toMatchObject({
      sessionId: 'session-after-slash',
      followUpMessage: expect.any(String),
    });
  });

  it.each([
    ['/run git status', 'git', 'status'],
    ['/run pnpm --filter @ai-team/web storybook', 'pnpm', '--filter @ai-team/web storybook'],
  ])('dispatches the legacy one-token run alias: %s', async (message, commandName, rawArgs) => {
    const { command, commandDispatcher, stepService } = createDeps({
      resolveLatestSessionForResume: async () => ({
        id: 'sess-latest',
        agentId: 'michael-brown',
      }),
      getAgentAsync: async (id: string) => ({ id, name: 'Michael Brown', role: 'ceo' }),
      getLatestSession: async () => ({ id: 'sess-agent', agentId: 'michael-brown' }),
      getSessionMessages: async () => [],
    });
    commandDispatcher.getCommands.mockReturnValue([
      {
        key: 'run',
        group: 'chat',
        aliases: ['run', 'shell'],
        availableIn: { chat: true },
      },
    ]);
    commandDispatcher.dispatch.mockResolvedValue({
      status: 'ok',
      message: 'Command executed',
      data: {},
    });

    await command.execute({ options: { message } } as any, { history: [] } as any);

    expect(commandDispatcher.dispatch).toHaveBeenCalledWith(
      'chat-run',
      `${commandName} ${rawArgs}`,
      expect.anything()
    );
    expect(stepService.invokeTurnLlmAsync).not.toHaveBeenCalled();
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
