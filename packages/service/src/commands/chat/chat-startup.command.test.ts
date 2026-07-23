import { describe, expect, it, vi } from 'vitest';
import { ChatStartupCommand } from './chat-startup.command.js';

describe('ChatStartupCommand', () => {
  it('runs startup workflow and emits resume context', async () => {
    const startupTargetResolver = {
      resolve: vi.fn(async () => ({
        sessionId: 'session-1',
        agent: {
          id: 'sarah-lee',
          name: 'Sarah Lee',
          role: 'chief-architect',
        },
      })),
    };
    const resolveChatSessionCommand = {
      execute: vi.fn(async () => ({
        sessionId: 'session-1',
        shouldLoadHistory: true,
        reason: 'startup' as const,
      })),
    };
    const loadSessionMessagesCommand = {
      execute: vi.fn(async () => []),
    };
    const chatInfoService = {
      showSessionIntro: vi.fn(),
      showLoadedInstructions: vi.fn(),
      showSessionResume: vi.fn(),
      showThreadResume: vi.fn(),
      showActiveSession: vi.fn(),
      showWorkspaceInfo: vi.fn(),
    };
    const chatThreadTranscriptService = {
      load: vi.fn(async () => [{ kind: 'message', message: { content: 'earlier' } }]),
    };
    const introductionCommand = {
      execute: vi.fn(async () => undefined),
    };
    const developerIdentityService = {
      getUserName: vi.fn(() => 'Clemens Meier'),
    };
    const identityResolver = {
      resolve: vi.fn((agent: any) => ({
        ...agent,
        resolvedLlm: { model: 'gpt-5.2', isDefault: false },
      })),
    };

    const command = new ChatStartupCommand(
      resolveChatSessionCommand as any,
      loadSessionMessagesCommand as any,
      introductionCommand as any,
      chatThreadTranscriptService as any,
      chatInfoService as any,
      developerIdentityService as any,
      identityResolver as any,
      startupTargetResolver as any,
      'C:\\Projects\\ai-team',
      {
        getSystemInfo: vi.fn(() => ({
          workspace: 'C:\\Projects\\ai-team',
          branch: 'feature/tui',
          package: null,
        })),
      }
    );

    const response = await command.execute(
      {
        employeeId: 'sarah-lee',
        options: {
          sessionId: 'session-1',
          createNewSession: false,
        },
      },
      {
        invocationSurface: 'cli',
        history: [],
      } as any
    );

    expect(startupTargetResolver.resolve).toHaveBeenCalledWith({
      agentQuery: 'sarah-lee',
      sessionId: 'session-1',
      createNewSession: false,
    });
    expect(resolveChatSessionCommand.execute).toHaveBeenCalled();
    expect(loadSessionMessagesCommand.execute).toHaveBeenCalledWith({
      sessionId: 'session-1',
      reason: 'startup',
    });
    expect(chatInfoService.showSessionIntro).toHaveBeenCalledWith(
      expect.objectContaining({
        developerName: 'Clemens Meier',
        agent: expect.objectContaining({
          resolvedLlm: expect.objectContaining({ model: 'gpt-5.2' }),
        }),
      })
    );
    expect(chatThreadTranscriptService.load).toHaveBeenCalledWith('session-1');
    expect(chatInfoService.showWorkspaceInfo).toHaveBeenCalledWith({
      workspace: 'C:\\Projects\\ai-team',
      gitBranch: 'feature/tui',
    });
    expect(chatInfoService.showActiveSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      agentId: 'sarah-lee',
    });
    expect(chatInfoService.showThreadResume).toHaveBeenCalledWith(
      await chatThreadTranscriptService.load.mock.results[0].value,
      'Clemens Meier'
    );

    expect(response).toEqual({ status: 'ok', data: '', message: 'completed' });
  });

  it('returns an explicit error when no startup target can be resolved', async () => {
    const command = new ChatStartupCommand(
      { execute: vi.fn() } as any,
      { execute: vi.fn() } as any,
      { execute: vi.fn() } as any,
      { load: vi.fn() } as any,
      {
        showSessionIntro: vi.fn(),
        showLoadedInstructions: vi.fn(),
        showSessionResume: vi.fn(),
        showThreadResume: vi.fn(),
        showActiveSession: vi.fn(),
        showWorkspaceInfo: vi.fn(),
      } as any,
      { getUserName: vi.fn(() => 'Clemens Meier') } as any,
      undefined,
      { resolve: vi.fn(async () => null) } as any,
      'C:\\Projects\\ai-team',
      {
        getSystemInfo: vi.fn(() => ({
          workspace: 'C:\\Projects\\ai-team',
          branch: null,
          package: null,
        })),
      }
    );

    const response = await command.execute(
      {
        employeeId: undefined,
        options: {},
      },
      { history: [] } as any
    );

    expect(response).toEqual({
      status: 'error',
      message: 'Unable to resolve a chat agent or resumable session',
    });
  });
});
