import { describe, expect, it } from 'vitest';
import type { ICommand, IServiceContainer } from '@ai-team/core';
import { CommandDispatcher } from './command-dispatcher.js';
import { CommandRegistry } from './command-registry-impl.js';

function makeDispatcher(): CommandDispatcher {
  const registry = new CommandRegistry();
  const resolver = {
    resolve: () => {
      throw new Error('not used in tests');
    },
    tryResolve: () => undefined,
    has: () => false,
    child: function () {
      return this;
    },
    register: function () {
      return this;
    },
    registerSingleton: function () {
      return this;
    },
    registerTransient: function () {
      return this;
    },
    registerScoped: function () {
      return this;
    },
    registerInstance: function () {
      return this;
    },
  } as unknown as IServiceContainer;
  return new CommandDispatcher(registry, resolver);
}

describe('CommandDispatcher typed dispatch', () => {
  it('supports registerCommand(ICommand) and typed dispatchCommand', async () => {
    const dispatcher = makeDispatcher();

    const command: ICommand<{ name: string }, { greeting: string }> = {
      metadata: {
        key: 'typed-greet-register',
        description: 'typed greet register',
        availableIn: { cli: true },
      },
      execute: async (payload) => ({ greeting: `Hi ${payload.name}` }),
    };

    dispatcher.registerCommand(command);

    const result = await dispatcher.dispatchCommand(command, { name: 'Leah' });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ greeting: 'Hi Leah' });
  });

  it('supports dispatchCommand(command, payload) with typed payload/result', async () => {
    const dispatcher = makeDispatcher();

    dispatcher.register({
      key: 'typed-greet',
      description: 'typed greet',
      availableIn: { cli: true },
      handler: async (_workspaceRoot: string, payload: unknown) => {
        const typedPayload = payload as { name: string };
        return {
          status: 'ok' as const,
          message: '',
          data: { greeting: `Hi ${typedPayload.name}` },
        };
      },
    });

    const typedCommand: ICommand<{ name: string }, { greeting: string }> = {
      metadata: { key: 'typed-greet', description: 'typed greet', availableIn: { cli: true } },
      execute: async () => ({ greeting: 'unused' }),
    };

    const result = await dispatcher.dispatchCommand(typedCommand, { name: 'Maya' });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ greeting: 'Hi Maya' });
  });

  it('supports generic dispatch<TCommand>(request) overload', async () => {
    const dispatcher = makeDispatcher();

    dispatcher.register({
      key: 'typed-greet',
      description: 'typed greet',
      availableIn: { cli: true },
      handler: async (_workspaceRoot: string, payload: unknown) => {
        const typedPayload = payload as { name: string };
        return {
          status: 'ok' as const,
          message: '',
          data: { greeting: `Hi ${typedPayload.name}` },
        };
      },
    });

    type TypedGreetCommand = ICommand<{ name: string }, { greeting: string }>;

    const result = await dispatcher.dispatch<TypedGreetCommand>({
      command: 'typed-greet',
      payload: { name: 'Alex' },
    });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ greeting: 'Hi Alex' });
  });
});
