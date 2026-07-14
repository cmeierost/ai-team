import { describe, expect, it, vi } from 'vitest';
import type { CommandResponse } from '@ai-team/api-contracts';
import type { CommandAvailability, ExecutionContext, IServiceContainer } from '@ai-team/core';
import { CliCommandClient } from './cli-command-client.js';

function createClient(): CliCommandClient {
  const resolver = {
    child: () => resolver,
    registerInstance: () => resolver,
    registerSingleton: () => resolver,
    registerScoped: () => resolver,
    registerTransient: () => resolver,
    has: () => false,
    tryResolve: () => undefined,
    resolve: () => {
      throw new Error('resolve not implemented in test resolver');
    },
  } as unknown as IServiceContainer;

  return new CliCommandClient('C:/workspace', resolver);
}

type DirectHandler = (
  workspaceRoot: string,
  payload: unknown,
  ctx: ExecutionContext
) => Promise<CommandResponse>;

function registerDirect(
  client: CliCommandClient,
  key: string,
  handler: DirectHandler,
  availability: CommandAvailability = { cli: true, chat: false, tool: false }
): void {
  (client as unknown as { dispatcher: { register: (entry: unknown) => void } }).dispatcher.register(
    {
      key,
      description: key,
      availableIn: availability,
      handler,
    }
  );
}

function createEmitServiceStub() {
  return {
    emit: vi.fn(),
    status: vi.fn(),
    log: vi.fn(),
    token: vi.fn(),
    toolLifecycle: vi.fn(),
  };
}

describe('CliCommandClient.invokeTool stdout capture', () => {
  it('does not capture stdout for interactive chat command', async () => {
    const client = createClient();
    registerDirect(client, 'chat', async () => {
      process.stdout.write('chat prompt output\n');
      return { status: 'ok', message: '' };
    });

    const emitService = createEmitServiceStub();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await client.invokeTool(
      { command: 'chat', payload: {} },
      { workspaceRoot: 'C:/workspace', history: [] } as ExecutionContext,
      emitService as any
    );

    expect(stdoutSpy).toHaveBeenCalledWith('chat prompt output\n');
    expect(emitService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'token', text: 'chat prompt output\n' })
    );
  });

  it('does not capture stdout for interactive chat command', async () => {
    const client = createClient();
    const dispatchSpy = vi.fn(async () => {
      process.stdout.write('You: ');
      return { status: 'ok' as const, message: '' };
    });
    (
      client as unknown as {
        dispatcher: { dispatch: (request: unknown) => Promise<CommandResponse> };
      }
    ).dispatcher = {
      dispatch: dispatchSpy,
    };

    const emitService = createEmitServiceStub();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await client.invokeTool(
        { command: 'chat-chat', payload: {} } as any,
        { workspaceRoot: 'C:/workspace', history: [] } as ExecutionContext,
        emitService as any
      );
    } finally {
      stdoutSpy.mockRestore();
    }

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(emitService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'token', text: 'You: ' })
    );
  });

  it('captures stdout for non-chat commands as token runtime events', async () => {
    const client = createClient();
    registerDirect(client, 'demo-cmd', async () => {
      process.stdout.write('demo output\n');
      return { status: 'ok', message: '' };
    });

    const emitService = createEmitServiceStub();

    await client.invokeTool(
      { command: 'demo-cmd', payload: {} },
      { workspaceRoot: 'C:/workspace', history: [] } as ExecutionContext,
      emitService as any
    );

    expect(emitService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'token', text: 'demo output\n' })
    );
  });
});
