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
    } as any;

    const threadManager = {
      resolveHandoffSession: vi.fn(async () => ({ session: { id: 'sess-michael' }, isNew: true })),
    } as any;

    const llmService = {
      chat: vi.fn(async () => 'Briefing for Michael.'),
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
  });
});
