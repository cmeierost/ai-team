import { describe, expect, it, vi } from 'vitest';
import { LoadSessionMessagesCommand } from './load-session-messages.command.js';

describe('LoadSessionMessagesCommand', () => {
  it('does not emit perf log by default when sessionStartupLoad logging is disabled', async () => {
    const messages = [
      {
        from: 'human',
        to: 'agent',
        content: 'hello',
        timestamp: new Date().toISOString(),
        isHuman: true,
      },
    ];

    const sessionManager = {
      getSessionMessages: vi.fn(async () => messages),
    };
    const emitService = {
      log: vi.fn(),
      emit: vi.fn(),
    } as any;

    const command = new LoadSessionMessagesCommand(
      sessionManager as any,
      emitService,
      {
        get: vi.fn((_path?: string) => undefined),
      } as any,
      { logAsync: vi.fn() } as any
    );

    const result = await command.execute({ sessionId: 'session-1', reason: 'startup' });

    expect(result).toEqual(messages);
    expect(sessionManager.getSessionMessages).toHaveBeenCalledWith('session-1');
    expect(emitService.log).not.toHaveBeenCalled();
  });

  it('emits perf log when sessionStartupLoad logging is enabled for console', async () => {
    const messages = [
      {
        from: 'human',
        to: 'agent',
        content: 'hello',
        timestamp: new Date().toISOString(),
        isHuman: true,
      },
      {
        from: 'agent',
        to: 'human',
        content: 'hi',
        timestamp: new Date().toISOString(),
        isHuman: false,
      },
    ];

    const sessionManager = {
      getSessionMessages: vi.fn(async () => messages),
    };
    const emitService = {
      log: vi.fn(),
      emit: vi.fn(),
    } as any;

    const command = new LoadSessionMessagesCommand(
      sessionManager as any,
      emitService,
      {
        get: vi.fn((path?: string) =>
          path === 'log.chat.sessionStartupLoad'
            ? { enabled: true, console: 'info', file: 'off' }
            : undefined
        ),
      } as any,
      { logAsync: vi.fn() } as any
    );

    const result = await command.execute({ sessionId: 'session-2', reason: 'startup' });

    expect(result).toEqual(messages);
    expect(emitService.log).toHaveBeenCalledTimes(1);
    expect(emitService.log).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('[perf] loaded 2 message(s) for session session-2')
    );
  });
});
