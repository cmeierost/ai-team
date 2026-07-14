import { describe, expect, it, vi } from 'vitest';
import { ResolveChatSessionCommand } from './resolve-chat-session.command.js';
import { LoadSessionMessagesCommand } from './load-session-messages.command.js';
import { runChatSessionStartup } from './chat-session-startup.js';

describe('chat session startup', () => {
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

    const result = await runChatSessionStartup(
      {
        agent: {
          id: 'agent-1',
          name: 'Agent One',
          role: 'assistant',
        } as any,
        options: {
          sessionId: 'sess-123',
          createNewSession: false,
          introduction: true,
        },
        developerName: 'Clemens',
      },
      {
        resolveChatSessionCommand,
        loadSessionMessagesCommand,
        introductionCommand: { execute: vi.fn(async () => undefined) } as any,
      },
      {} as any
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

    const result = await runChatSessionStartup(
      {
        agent: {
          id: 'agent-2',
          name: 'Agent Two',
          role: 'assistant',
        } as any,
        options: {
          createNewSession: true,
          introduction: false,
        },
        developerName: 'Clemens',
      },
      {
        resolveChatSessionCommand,
        loadSessionMessagesCommand,
        introductionCommand: { execute: vi.fn(async () => undefined) } as any,
      },
      {} as any
    );

    expect(result.sessionId).toBe('fresh-001');
    expect(result.history).toEqual([]);
    expect(sessionManager.createSession).toHaveBeenCalledWith('agent-2', 'dev-clemens');
    expect(sessionManager.getSessionMessages).not.toHaveBeenCalled();
  });

  it('runs introduction command for newly created sessions when introduction is enabled', async () => {
    const sessionManager = {
      createSession: vi.fn(async () => ({ id: 'fresh-002' })),
      getLatestSession: vi.fn(async () => null),
      getSessionMessages: vi.fn(async () => []),
    };

    const resolveChatSessionCommand = new ResolveChatSessionCommand(sessionManager as any, {
      toDeveloperId: vi.fn((name: string) => `dev-${name.toLowerCase()}`),
    });
    const loadSessionMessagesCommand = new LoadSessionMessagesCommand(
      sessionManager as any,
      { log: vi.fn(), emit: vi.fn() } as any
    );
    const introductionCommand = {
      execute: vi.fn(async () => undefined),
    };

    await runChatSessionStartup(
      {
        agent: {
          id: 'agent-3',
          name: 'Agent Three',
          role: 'assistant',
        } as any,
        options: {
          createNewSession: true,
          introduction: true,
        },
        developerName: 'Clemens',
      },
      {
        resolveChatSessionCommand,
        loadSessionMessagesCommand,
        introductionCommand: introductionCommand as any,
      },
      {
        signal: undefined,
        invocationSurface: 'cli',
        workflowState: undefined,
        history: [],
      } as any
    );

    expect(introductionCommand.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'fresh-002',
        developerName: 'Clemens',
      })
    );
  });
});
