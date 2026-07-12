import { describe, expect, it, vi } from 'vitest';
import { ChatV2Command } from './chat-v2.command.js';

describe('ChatV2Command', () => {
  it('returns ok response with output text when runtime completes', async () => {
    const runtime = {
      runAsync: vi.fn(async () => ({
        status: 'completed' as const,
        text: 'hello from v2',
        hopCount: 0,
      })),
    };
    const emitService = { log: vi.fn() } as any;
    const questionService = {
      input: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(),
      password: vi.fn(),
      checklist: vi.fn(),
    } as any;

    const command = new ChatV2Command(runtime as any, emitService, questionService);
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
      data: 'hello from v2',
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
    const questionService = {
      input: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(),
      password: vi.fn(),
      checklist: vi.fn(),
    } as any;

    const command = new ChatV2Command(runtime as any, emitService, questionService);
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
    const questionService = {
      input: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(),
      password: vi.fn(),
      checklist: vi.fn(),
    } as any;

    const command = new ChatV2Command(runtime as any, emitService, questionService);
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
    const questionService = {
      input: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(),
      password: vi.fn(),
      checklist: vi.fn(),
    } as any;

    const command = new ChatV2Command(runtime as any, emitService, questionService);
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

  it('runs in interactive mode when no message is provided', async () => {
    const runtime = {
      runAsync: vi
        .fn()
        .mockResolvedValueOnce({ status: 'completed' as const, text: 'hello there', hopCount: 0 })
        .mockResolvedValueOnce({ status: 'completed' as const, text: '', hopCount: 0 }),
    };
    const emitService = { log: vi.fn() } as any;
    const questionService = {
      input: vi.fn().mockResolvedValueOnce('Hi Michael').mockResolvedValueOnce('exit'),
      confirm: vi.fn(),
      select: vi.fn(),
      password: vi.fn(),
      checklist: vi.fn(),
    } as any;

    const command = new ChatV2Command(runtime as any, emitService, questionService);
    const response = await command.execute(
      {
        agentId: 'michael-brown',
      } as any,
      { history: [] } as any
    );

    expect(runtime.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'michael-brown', message: 'Hi Michael' })
    );
    expect(emitService.log).toHaveBeenCalledWith('info', 'hello there');
    expect(response).toEqual({
      status: 'ok',
      message: 'interactive_exit',
      data: '',
    });
  });

  it('exits interactive mode gracefully when prompt input is closed', async () => {
    const runtime = {
      runAsync: vi.fn(),
    };
    const emitService = { log: vi.fn() } as any;
    const questionService = {
      input: vi.fn(async () => {
        throw new Error('prompt closed');
      }),
      confirm: vi.fn(),
      select: vi.fn(),
      password: vi.fn(),
      checklist: vi.fn(),
    } as any;

    const command = new ChatV2Command(runtime as any, emitService, questionService);
    const response = await command.execute(
      {
        agentId: 'michael-brown',
      } as any,
      { history: [] } as any
    );

    expect(runtime.runAsync).not.toHaveBeenCalled();
    expect(emitService.log).toHaveBeenCalledWith('info', 'Goodbye!');
    expect(response).toEqual({
      status: 'ok',
      message: 'interactive_exit',
      data: '',
    });
  });
});
