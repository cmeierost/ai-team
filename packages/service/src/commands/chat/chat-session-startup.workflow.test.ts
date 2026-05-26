import { describe, expect, it, vi } from 'vitest';
import { ResolveChatSessionCommand } from './resolve-chat-session.command.js';
import { LoadSessionMessagesCommand } from './load-session-messages.command.js';
import { runChatSessionStartupWorkflow } from './chat-session-startup.workflow.js';
import type { IWorkflowRunnerFactory } from '../../workflow/runner.js';

function makeTestRunnerFactory(): IWorkflowRunnerFactory {
  return {
    create: () => ({
      async run(definition, initialState, options) {
        let state = initialState;
        const cmds = options?.commands ?? {};
        const ctx = options?.executionContext ?? ({} as any);
        for (const step of definition.steps) {
          if (step.skipWhen?.(state)) {
            continue;
          }
          if ('command' in step) {
            const cmd = cmds[step.command];
            if (!cmd) throw new Error(`Command not found: ${step.command}`);
            const params = step.params(state);
            const result = await cmd.execute(params, ctx);
            if (step.applyResult) {
              state = step.applyResult(state, result);
            }
          } else if ('execute' in step) {
            state = await step.execute(state, ctx);
          }
        }
        return { aborted: false, state };
      },
    }),
  };
}

describe('chat-session-startup workflow', () => {
  it('loads existing session when sessionId is provided', async () => {
    const sessionManager = {
      createSession: vi.fn(async () => ({ id: 'new-session' })),
      getLatestSession: vi.fn(async () => null),
      getSessionMessages: vi.fn(async () => [
        {
          from: 'human',
          to: 'agent',
          content: 'hello',
          timestamp: new Date().toISOString(),
          isHuman: true,
        },
      ]),
    };

    const resolveChatSessionCommand = new ResolveChatSessionCommand(sessionManager as any, {
      toDeveloperId: vi.fn((name: string) => name.toLowerCase()),
    });
    const loadSessionMessagesCommand = new LoadSessionMessagesCommand(
      sessionManager as any,
      { log: vi.fn(), emit: vi.fn() } as any
    );

    const result = await runChatSessionStartupWorkflow(
      {
        currentAgentId: 'agent-1',
        options: {
          sessionId: 'sess-123',
          createNewSession: false,
        },
        developerName: 'Clemens',
      },
      {
        resolveChatSessionCommand,
        loadSessionMessagesCommand,
      },
      {},
      makeTestRunnerFactory()
    );

    expect(result.sessionId).toBe('sess-123');
    expect(result.history).toHaveLength(1);
    expect(sessionManager.getSessionMessages).toHaveBeenCalledWith('sess-123');
    expect(sessionManager.createSession).not.toHaveBeenCalled();
  });

  it('creates a new session without loading history when createNewSession is true', async () => {
    const sessionManager = {
      createSession: vi.fn(async () => ({ id: 'fresh-001' })),
      getLatestSession: vi.fn(async () => ({ id: 'latest-should-not-be-used' })),
      getSessionMessages: vi.fn(async () => []),
    };

    const resolveChatSessionCommand = new ResolveChatSessionCommand(sessionManager as any, {
      toDeveloperId: vi.fn((name: string) => `dev-${name.toLowerCase()}`),
    });
    const loadSessionMessagesCommand = new LoadSessionMessagesCommand(
      sessionManager as any,
      { log: vi.fn(), emit: vi.fn() } as any
    );

    const result = await runChatSessionStartupWorkflow(
      {
        currentAgentId: 'agent-2',
        options: {
          createNewSession: true,
        },
        developerName: 'Clemens',
      },
      {
        resolveChatSessionCommand,
        loadSessionMessagesCommand,
      },
      {},
      makeTestRunnerFactory()
    );

    expect(result.sessionId).toBe('fresh-001');
    expect(result.history).toEqual([]);
    expect(sessionManager.createSession).toHaveBeenCalledWith('agent-2', 'dev-clemens');
    expect(sessionManager.getSessionMessages).not.toHaveBeenCalled();
  });
});
