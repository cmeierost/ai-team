import { describe, expect, it, vi } from 'vitest';
import { ChatCommand } from './chat.command.js';

describe('ChatCommand', () => {
  it('returns ok response with output text when runtime completes', async () => {
    const runtime = {
      runAsync: vi.fn(async () => ({
        status: 'completed' as const,
        text: 'hello from chat',
        hopCount: 0,
      })),
    };
    const emitService = { log: vi.fn() } as any;

    const command = new ChatCommand(runtime as any, emitService);
    const response = await command.execute(
      {
        message: 'hello',
      },
      {
        history: [],
      } as any
    );

    expect(response).toEqual({
      status: 'ok',
      data: 'hello from chat',
      message: 'completed',
    });
    expect(runtime.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        agentId: undefined,
      })
    );
    expect(emitService.log).not.toHaveBeenCalled();
  });

  it('passes agentId through to runtime when provided', async () => {
    const runtime = {
      runAsync: vi.fn(async () => ({
        status: 'completed' as const,
        text: 'ok',
        hopCount: 0,
      })),
    };
    const emitService = { log: vi.fn() } as any;

    const command = new ChatCommand(runtime as any, emitService);
    await command.execute(
      {
        message: 'hello',
        agentId: 'alex-morgan',
      },
      {
        history: [],
      } as any
    );

    expect(runtime.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        agentId: 'alex-morgan',
      })
    );
  });

  it('passes sessionId through to runtime when provided', async () => {
    const runtime = {
      runAsync: vi.fn(async () => ({
        status: 'completed' as const,
        text: 'ok',
        hopCount: 0,
      })),
    };
    const emitService = { log: vi.fn() } as any;

    const command = new ChatCommand(runtime as any, emitService);
    await command.execute(
      {
        message: 'hello',
        sessionId: 'session-123',
      },
      {
        history: [],
      } as any
    );

    expect(runtime.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        sessionId: 'session-123',
      })
    );
  });

  it('passes createNewSession through to runtime when provided', async () => {
    const runtime = {
      runAsync: vi.fn(async () => ({
        status: 'completed' as const,
        text: 'ok',
        hopCount: 0,
      })),
    };
    const emitService = { log: vi.fn() } as any;

    const command = new ChatCommand(runtime as any, emitService);
    await command.execute(
      {
        message: 'hello',
        createNewSession: true,
      },
      {
        history: [],
      } as any
    );

    expect(runtime.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        createNewSession: true,
      })
    );
  });

  it('returns error response and emits error when runtime fails', async () => {
    const runtime = {
      runAsync: vi.fn(async () => ({
        status: 'failed' as const,
        text: '',
        hopCount: 0,
        error: 'boom',
      })),
    };
    const emitService = { log: vi.fn() } as any;

    const command = new ChatCommand(runtime as any, emitService);
    const response = await command.execute(
      {
        message: 'hello',
      },
      {
        history: [],
      } as any
    );

    expect(response).toEqual({
      status: 'error',
      message: 'boom',
    });
    expect(emitService.log).toHaveBeenCalledWith('error', 'boom');
  });

  it('forwards execution context signal to runtime', async () => {
    const runtime = {
      runAsync: vi.fn(async () => ({
        status: 'completed' as const,
        text: 'ok',
        hopCount: 0,
      })),
    };
    const emitService = { log: vi.fn() } as any;
    const signal = new AbortController().signal;

    const command = new ChatCommand(runtime as any, emitService);
    await command.execute(
      { message: 'hello' },
      {
        history: [],
        signal,
      } as any
    );

    expect(runtime.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        signal,
      })
    );
  });

  it('returns error when no message is provided', async () => {
    const runtime = {
      runAsync: vi.fn(),
    };
    const emitService = { log: vi.fn() } as any;

    const command = new ChatCommand(runtime as any, emitService);
    const response = await command.execute(
      {
        agentId: 'michael-brown',
      } as any,
      { history: [] } as any
    );

    expect(runtime.runAsync).not.toHaveBeenCalled();
    expect(emitService.log).toHaveBeenCalledWith('error', 'Chat message is required.');
    expect(response).toEqual({
      status: 'error',
      message: 'Chat message is required.',
    });
  });
});
