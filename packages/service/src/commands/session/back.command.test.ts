import { describe, expect, it, vi } from 'vitest';
import { BackChatCommand } from './back.command.js';

describe('BackChatCommand', () => {
  it('uses persisted conversational history instead of a stale execution-context stack', async () => {
    const emily = { id: 'emily-davis', name: 'Emily Davis', role: 'HR Director' };
    const threadManager = {
      resolveActiveSession: vi.fn(async () => ({
        session: { id: 'session-michael' },
        state: {
          rootSessionId: 'session-michael',
          activeSessionId: 'session-michael',
          navigationStack: [
            {
              agentId: 'emily-davis',
              agentName: 'Emily Davis',
              sessionId: 'session-emily',
            },
          ],
          updatedAt: new Date().toISOString(),
        },
      })),
    };
    const handoffSubWorkflow = {
      executeAsync: vi.fn(async () => ({
        fromAgent: { id: 'michael-brown' },
        targetAgent: emily,
        toSessionId: 'session-emily',
        briefingContent: 'Returning to Emily.',
        history: [],
        handoffId: 'handoff-1',
        fromSessionId: 'session-michael',
        navigationStack: [],
      })),
    };
    const emitService = { emit: vi.fn() };
    const command = new BackChatCommand(
      handoffSubWorkflow as any,
      threadManager as any,
      emitService as any
    );
    const ctx = {
      agent: { id: 'michael-brown', name: 'Michael Brown', role: 'CEO' },
      agentId: 'michael-brown',
      sessionId: 'session-michael',
      history: [],
      navStack: [],
    } as any;

    const result = await command.execute('', ctx);

    expect(result.status).toBe('ok');
    expect(handoffSubWorkflow.executeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgentQuery: 'emily-davis',
        navigationIntent: 'back',
      })
    );
    expect(ctx.agent).toBe(emily);
    expect(ctx.sessionId).toBe('session-emily');
  });
});
