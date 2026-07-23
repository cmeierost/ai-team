import { describe, expect, it, vi } from 'vitest';
import { HandoffSubWorkflow } from './handoff-subworkflow.js';

function makeAgent(id: string, name: string, role: string) {
  return { id, name, role } as any;
}

describe('HandoffSubWorkflow', () => {
  const EMILY = makeAgent('emily-davis', 'Emily Davis', 'frontend-developer');
  const MICHAEL = makeAgent('michael-brown', 'Michael Brown', 'ceo');

  function makeDeps() {
    const agentManager = {
      resolveAgentForOperationAsync: vi.fn(async () => ({ id: MICHAEL.id })),
      getAgentAsync: vi.fn(async (id: string) => {
        if (id === MICHAEL.id) return MICHAEL;
        if (id === EMILY.id) return EMILY;
        return null;
      }),
      resolveAgentAsync: vi.fn(async () => [MICHAEL]),
      getAllAgentsAsync: vi.fn(async () => [EMILY, MICHAEL]),
    } as any;

    const sessionManager = {
      getSession: vi.fn(async (_sessionId: string) => ({ id: 'sess-emily', developerId: 'dev-1' })),
      getSessionMessages: vi.fn(async () => []),
      appendMessage: vi.fn(async () => undefined),
      deleteSessionMessage: vi.fn(async () => true),
    } as any;

    const threadManager = {
      resolveActiveSession: vi.fn(async () => ({
        session: { id: 'sess-emily' },
        state: {
          rootSessionId: 'sess-emily',
          activeSessionId: 'sess-emily',
          navigationStack: [],
          updatedAt: new Date().toISOString(),
        },
      })),
      resolveHandoffSession: vi.fn(async () => ({ session: { id: 'sess-michael' }, isNew: true })),
      recordHandoff: vi.fn(async () => ({
        rootSessionId: 'sess-emily',
        activeSessionId: 'sess-michael',
        navigationStack: [
          {
            agentId: 'emily-davis',
            agentName: 'Emily Davis',
            sessionId: 'sess-emily',
          },
        ],
        updatedAt: new Date().toISOString(),
      })),
      recordReturn: vi.fn(async () => ({
        rootSessionId: 'sess-michael',
        activeSessionId: 'sess-michael',
        navigationStack: [
          {
            agentId: 'emily-davis',
            agentName: 'Emily Davis',
            sessionId: 'sess-emily',
          },
        ],
        updatedAt: new Date().toISOString(),
      })),
      recordBack: vi.fn(async () => ({
        rootSessionId: 'sess-michael',
        activeSessionId: 'sess-emily',
        navigationStack: [],
        updatedAt: new Date().toISOString(),
      })),
    } as any;

    const streamChat = vi.fn(async () => {
      return (async function* () {
        yield { choices: [{ delta: { content: 'Briefing for ' } }] };
        yield { choices: [{ delta: { content: 'Michael.' } }] };
      })();
    });
    const llmService = {
      chat: vi.fn(async () => 'Briefing for Michael.'),
      streamChat,
    } as any;

    const emitService = {
      emit: vi.fn(),
      log: vi.fn(),
      status: vi.fn(),
      token: vi.fn(),
      toolEvent: vi.fn(),
      write: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      event: vi.fn(),
    } as any;

    return { agentManager, sessionManager, threadManager, llmService, emitService };
  }

  it('resolves target with operation-level fuzzy resolution and runs thread graph session resolution', async () => {
    const { agentManager, sessionManager, threadManager, llmService, emitService } = makeDeps();
    const workflow = new HandoffSubWorkflow(
      agentManager,
      sessionManager,
      threadManager,
      llmService,
      emitService
    );

    const ctx: any = {
      agent: EMILY,
      sessionId: 'sess-emily',
      history: [],
    };

    const result = await workflow.executeAsync({
      ctx,
      targetAgentQuery: 'michael',
      handoffNote: 'please take over',
    });

    expect(agentManager.resolveAgentForOperationAsync).toHaveBeenCalledWith(
      'michael',
      'chat handoff'
    );
    expect(threadManager.resolveHandoffSession).toHaveBeenCalledWith(
      'michael-brown',
      'sess-emily',
      'dev-1'
    );
    expect(result.targetAgent.id).toBe('michael-brown');
    expect(result.toSessionId).toBe('sess-michael');
    expect(threadManager.recordHandoff).toHaveBeenCalledWith(
      'sess-emily',
      'sess-michael',
      expect.objectContaining({ agentId: 'emily-davis' })
    );
  });

  it('streams the source-agent briefing before persistence and completes the handoff afterward', async () => {
    const { agentManager, sessionManager, threadManager, llmService, emitService } = makeDeps();
    const workflow = new HandoffSubWorkflow(
      agentManager,
      sessionManager,
      threadManager,
      llmService,
      emitService
    );

    const result = await workflow.executeAsync({
      ctx: { agent: EMILY, sessionId: 'sess-emily', history: [] } as any,
      targetAgentQuery: 'michael',
      handoffNote: 'User explicitly requested to switch to michael.',
    });

    expect(result.briefingContent).toBe('Briefing for Michael.');
    expect(llmService.streamChat).toHaveBeenCalledOnce();
    expect(llmService.chat).not.toHaveBeenCalled();

    const handoffEvents = emitService.emit.mock.calls
      .map(([event]: [Record<string, unknown>]) => event)
      .filter((event: Record<string, unknown>) => event.kind === 'handoff');
    expect(handoffEvents.map((event: Record<string, unknown>) => event.handoffPhase)).toEqual([
      'start',
      'delta',
      'delta',
      'complete',
    ]);
    expect(handoffEvents[1]).toMatchObject({ delta: 'Briefing for ' });
    expect(handoffEvents[2]).toMatchObject({ delta: 'Michael.' });

    const firstDeltaCallOrder = emitService.emit.mock.invocationCallOrder[1];
    const firstPersistenceCallOrder = sessionManager.appendMessage.mock.invocationCallOrder[0];
    expect(firstDeltaCallOrder).toBeLessThan(firstPersistenceCallOrder);
  });

  it('treats a handoff to the parent session as a summarized return', async () => {
    const { agentManager, sessionManager, threadManager, llmService, emitService } = makeDeps();
    sessionManager.getSession.mockImplementation(async (sessionId: string) =>
      sessionId === 'sess-emily'
        ? {
            id: 'sess-emily',
            agentId: 'emily-davis',
            developerId: 'dev-1',
            previousSessionId: 'sess-michael',
          }
        : {
            id: 'sess-michael',
            agentId: 'michael-brown',
            developerId: 'dev-1',
          }
    );
    threadManager.resolveActiveSession.mockResolvedValue({
      session: { id: 'sess-emily' },
      state: {
        rootSessionId: 'sess-michael',
        activeSessionId: 'sess-emily',
        navigationStack: [
          {
            agentId: 'michael-brown',
            agentName: 'Michael Brown',
            sessionId: 'sess-michael',
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    });
    const workflow = new HandoffSubWorkflow(
      agentManager,
      sessionManager,
      threadManager,
      llmService,
      emitService
    );

    const result = await workflow.executeAsync({
      ctx: { agent: EMILY, sessionId: 'sess-emily', history: [] } as any,
      targetAgentQuery: 'michael',
      handoffNote: 'returning with a summary',
    });

    expect(threadManager.resolveHandoffSession).not.toHaveBeenCalled();
    expect(threadManager.recordReturn).toHaveBeenCalledWith(
      'sess-emily',
      'sess-michael',
      expect.objectContaining({ agentId: 'emily-davis' })
    );
    expect(result.toSessionId).toBe('sess-michael');
    expect(result.navigationStack).toEqual([expect.objectContaining({ sessionId: 'sess-emily' })]);
    expect(sessionManager.appendMessage).toHaveBeenCalledTimes(2);
    const firstMessage = sessionManager.appendMessage.mock.calls[0][1];
    const secondMessage = sessionManager.appendMessage.mock.calls[1][1];
    expect(firstMessage.handoffId).toBe(secondMessage.handoffId);
    const prompt = llmService.streamChat.mock.calls[0][1][0].content;
    expect(prompt).toContain('important discoveries');
    expect(prompt).toContain('decisions made');
    expect(prompt).toContain('unresolved questions');
    expect(prompt).toContain('recommended next action');
    expect(prompt).toContain('do not copy the full private conversation');
  });

  it('uses conversational history for /back independently of delegation ancestry', async () => {
    const { agentManager, sessionManager, threadManager, llmService, emitService } = makeDeps();
    threadManager.resolveActiveSession.mockResolvedValue({
      session: { id: 'sess-emily' },
      state: {
        rootSessionId: 'sess-michael',
        activeSessionId: 'sess-emily',
        navigationStack: [
          {
            agentId: 'michael-brown',
            agentName: 'Michael Brown',
            sessionId: 'sess-michael',
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    });
    const workflow = new HandoffSubWorkflow(
      agentManager,
      sessionManager,
      threadManager,
      llmService,
      emitService
    );

    const result = await workflow.executeAsync({
      ctx: { agent: EMILY, sessionId: 'sess-emily', history: [] } as any,
      targetAgentQuery: 'michael',
      navigationIntent: 'back',
    });

    expect(threadManager.recordBack).toHaveBeenCalledWith('sess-emily');
    expect(threadManager.recordReturn).not.toHaveBeenCalled();
    expect(result.toSessionId).toBe('sess-michael');
    expect(sessionManager.appendMessage).toHaveBeenCalledTimes(2);
    expect(sessionManager.appendMessage.mock.calls[0][1].handoffId).toBe(result.handoffId);
    expect(sessionManager.appendMessage.mock.calls[1][1].handoffId).toBe(result.handoffId);
    const prompt = llmService.streamChat.mock.calls[0][1][0].content;
    expect(prompt).toContain('important discoveries');
    expect(prompt).toContain('recommended next action');
  });

  it('does not classify a handoff to a non-parent existing agent as a delegation return', async () => {
    const { agentManager, sessionManager, threadManager, llmService, emitService } = makeDeps();
    sessionManager.getSession.mockImplementation(async (sessionId: string) =>
      sessionId === 'sess-emily'
        ? {
            id: 'sess-emily',
            agentId: 'emily-davis',
            developerId: 'dev-1',
            previousSessionId: 'sess-sarah',
          }
        : {
            id: sessionId,
            agentId: 'sarah-lee',
            developerId: 'dev-1',
          }
    );
    const workflow = new HandoffSubWorkflow(
      agentManager,
      sessionManager,
      threadManager,
      llmService,
      emitService
    );

    await workflow.executeAsync({
      ctx: { agent: EMILY, sessionId: 'sess-emily', history: [] } as any,
      targetAgentQuery: 'michael',
    });

    expect(threadManager.resolveHandoffSession).toHaveBeenCalledWith(
      'michael-brown',
      'sess-emily',
      'dev-1'
    );
    expect(threadManager.recordHandoff).toHaveBeenCalledOnce();
    expect(threadManager.recordReturn).not.toHaveBeenCalled();
  });

  it('compensates the first mirrored write when the second write fails', async () => {
    const { agentManager, sessionManager, threadManager, llmService, emitService } = makeDeps();
    sessionManager.appendMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('source write failed'));
    const workflow = new HandoffSubWorkflow(
      agentManager,
      sessionManager,
      threadManager,
      llmService,
      emitService
    );

    await expect(
      workflow.executeAsync({
        ctx: {
          agent: EMILY,
          sessionId: 'sess-emily',
          history: [{ from: 'emily-davis', content: 'source context' }],
        } as any,
        targetAgentQuery: 'michael',
      })
    ).rejects.toThrow('source write failed');

    expect(sessionManager.deleteSessionMessage).toHaveBeenCalledWith(
      'sess-michael',
      expect.any(String)
    );
    expect(threadManager.recordHandoff).not.toHaveBeenCalled();
    const phases = emitService.emit.mock.calls
      .map(([event]: [Record<string, unknown>]) => event)
      .filter((event: Record<string, unknown>) => event.kind === 'handoff')
      .map((event: Record<string, unknown>) => event.handoffPhase);
    expect(phases).toEqual(['start', 'delta', 'delta', 'cancelled']);
    expect(phases).not.toContain('complete');
  });

  it('cancels before persistence when target context loading fails', async () => {
    const { agentManager, sessionManager, threadManager, llmService, emitService } = makeDeps();
    sessionManager.getSessionMessages.mockRejectedValueOnce(new Error('target history unavailable'));
    const workflow = new HandoffSubWorkflow(
      agentManager,
      sessionManager,
      threadManager,
      llmService,
      emitService
    );

    await expect(
      workflow.executeAsync({
        ctx: {
          agent: EMILY,
          sessionId: 'sess-emily',
          history: [{ from: 'emily-davis', content: 'source context' }],
        } as any,
        targetAgentQuery: 'michael',
      })
    ).rejects.toThrow('target history unavailable');

    expect(sessionManager.appendMessage).not.toHaveBeenCalled();
    expect(threadManager.recordHandoff).not.toHaveBeenCalled();
    expect(
      emitService.emit.mock.calls
        .map(([event]: [Record<string, unknown>]) => event)
        .filter((event: Record<string, unknown>) => event.kind === 'handoff')
        .map((event: Record<string, unknown>) => event.handoffPhase)
    ).toEqual(['start', 'delta', 'delta', 'cancelled']);
  });

  it('compensates both mirrored messages when cursor persistence fails', async () => {
    const { agentManager, sessionManager, threadManager, llmService, emitService } = makeDeps();
    threadManager.recordHandoff.mockRejectedValueOnce(new Error('cursor write failed'));
    const workflow = new HandoffSubWorkflow(
      agentManager,
      sessionManager,
      threadManager,
      llmService,
      emitService
    );

    await expect(
      workflow.executeAsync({
        ctx: { agent: EMILY, sessionId: 'sess-emily', history: [] } as any,
        targetAgentQuery: 'michael',
      })
    ).rejects.toThrow('cursor write failed');

    expect(sessionManager.deleteSessionMessage).toHaveBeenCalledTimes(2);
    expect(sessionManager.deleteSessionMessage).toHaveBeenCalledWith(
      'sess-emily',
      expect.any(String)
    );
    expect(sessionManager.deleteSessionMessage).toHaveBeenCalledWith(
      'sess-michael',
      expect.any(String)
    );
    expect(
      emitService.emit.mock.calls
        .map(([event]: [Record<string, unknown>]) => event)
        .filter((event: Record<string, unknown>) => event.kind === 'handoff')
        .map((event: Record<string, unknown>) => event.handoffPhase)
    ).not.toContain('complete');
  });

  it('does not start a lifecycle or persist when target resolution fails', async () => {
    const { agentManager, sessionManager, threadManager, llmService, emitService } = makeDeps();
    agentManager.resolveAgentForOperationAsync.mockRejectedValueOnce(
      new Error('target resolution failed')
    );
    const workflow = new HandoffSubWorkflow(
      agentManager,
      sessionManager,
      threadManager,
      llmService,
      emitService
    );

    await expect(
      workflow.executeAsync({
        ctx: { agent: EMILY, sessionId: 'sess-emily', history: [] } as any,
        targetAgentQuery: 'missing',
      })
    ).rejects.toThrow('target resolution failed');

    expect(emitService.emit).not.toHaveBeenCalled();
    expect(sessionManager.appendMessage).not.toHaveBeenCalled();
    expect(threadManager.recordHandoff).not.toHaveBeenCalled();
  });
});
