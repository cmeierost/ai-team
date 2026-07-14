import { describe, expect, it, vi } from 'vitest';

import { HandoffChatCommand } from './handoff.command.js';
import { HANDOFF_AUTO_REACT_MESSAGE } from '../../workflow/chat/handoff-auto-react.js';

function makeAgent(id: string, name: string, role: string) {
  return { id, name, role } as any;
}

describe('HandoffChatCommand', () => {
  const EMILY = makeAgent('emily-davis', 'Emily Davis', 'frontend-developer');
  const MICHAEL = makeAgent('michael-brown', 'Michael Brown', 'ceo');

  function makeDeps() {
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

    const sessionManager = {
      getSession: vi.fn(async () => ({ id: 'sess-emily', developerId: 'dev-1' })),
      resolveHandoffSession: vi.fn(async () => ({ session: { id: 'sess-michael' }, isNew: true })),
      getSessionMessages: vi.fn(async () => []),
      appendMessage: vi.fn(async () => undefined),
    } as any;

    const agentManager = {
      resolveAgentAsync: vi.fn(async (query: string) => {
        const q = query.toLowerCase();
        if (q.includes('michael')) return [MICHAEL];
        if (q.includes('emily')) return [EMILY];
        return [];
      }),
      getAgentAsync: vi.fn(async (id: string) => {
        if (id === MICHAEL.id) return MICHAEL;
        if (id === EMILY.id) return EMILY;
        return null;
      }),
    } as any;

    const llmService = {
      chat: vi.fn(async () => 'Briefing for Michael.'),
    } as any;

    return { emitService, sessionManager, agentManager, llmService };
  }

  it('returns usage error when target is missing', async () => {
    const { emitService, sessionManager, agentManager, llmService } = makeDeps();
    const cmd = new HandoffChatCommand(agentManager, sessionManager, llmService, emitService);

    const result = await cmd.execute('', {
      agent: EMILY,
      sessionId: 'sess-emily',
      history: [],
    } as any);

    expect(result.status).toBe('error');
    expect(result.message).toContain('Usage');
  });

  it('hands off and returns prompt-forward data', async () => {
    const { emitService, sessionManager, agentManager, llmService } = makeDeps();
    const cmd = new HandoffChatCommand(agentManager, sessionManager, llmService, emitService);

    const ctx: any = {
      agent: EMILY,
      sessionId: 'sess-emily',
      history: [],
    };

    const result = await cmd.execute('michael-brown | needs CEO input', ctx);

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({
      source: 'prompt',
      promptText: HANDOFF_AUTO_REACT_MESSAGE,
    });
    expect(ctx.agent.id).toBe('michael-brown');
    expect(ctx.sessionId).toBe('sess-michael');
  });
});
