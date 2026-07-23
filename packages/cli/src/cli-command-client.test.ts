import { describe, expect, it, vi } from 'vitest';
import type { CommandResponse } from '@ai-team/api-contracts';
import type { CommandAvailability, ExecutionContext } from '@ai-team/core';
import { CliCommandClient } from './cli-command-client.js';

function createClient(): CliCommandClient {
  const handlers = new Map<string, DirectHandler>();
  return new CliCommandClient(
    {
      getCommands: () => [],
      register: (entry: { key: string; handler: DirectHandler }) => {
        handlers.set(entry.key, entry.handler);
      },
      dispatch: async (key: string, payload: unknown, ctx: ExecutionContext) => {
        const handler = handlers.get(key);
        return handler
          ? handler(ctx.workspaceRoot ?? '', payload, ctx)
          : { status: 'ok' as const, message: '' };
      },
    } as any,
    {
      emit: () => {},
      status: () => {},
      log: () => {},
      token: () => {},
      toolLifecycle: () => {},
    } as any,
    { write: () => {} } as any,
    { stream: async function* () {} } as any
  );
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

describe('CliCommandClient.streamInteraction shared chat path', () => {
  it('delegates chat-chat to the injected interaction service', async () => {
    const interactionService = {
      stream: vi.fn(async function* () {
        yield {
          command: 'chat-chat',
          kind: 'done',
          timestamp: new Date().toISOString(),
        };
      }),
    };
    const dispatcher = {
      getCommands: () => [],
      dispatch: vi.fn(),
    };
    const client = new CliCommandClient(
      dispatcher as any,
      createEmitServiceStub() as any,
      { write: vi.fn() } as any,
      interactionService as any
    );

    const events = [];
    for await (const event of client.streamInteraction({
      command: 'chat-chat',
      payload: { agentId: 'michael-brown', message: 'hello' },
    })) {
      events.push(event);
    }

    expect(interactionService.stream).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
  });
});
