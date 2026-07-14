import { describe, expect, it } from 'vitest';
import type { ICommand, IServiceContainer } from '@ai-team/core';
import type { IQuestionService } from '../interaction/question-service.js';
import { z } from 'zod';
import { CommandDispatcher } from './command-dispatcher.js';
import { CommandRegistry } from './command-registry.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';

function makeDispatcher(questionService?: IQuestionService): {
  dispatcher: CommandDispatcher;
  registry: CommandRegistry;
} {
  const registry = new CommandRegistry();
  const resolver = {
    resolve: () => {
      throw new Error('not used in tests');
    },
    tryResolve: (token: unknown) => {
      if (token === COMMAND_FACTORY_TOKENS.QuestionService) {
        return questionService;
      }
      return undefined;
    },
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
  return { dispatcher: new CommandDispatcher(registry, resolver), registry };
}

describe('CommandDispatcher typed dispatch', () => {
  it('supports registerCommand(ICommand) and typed dispatchCommand', async () => {
    const { dispatcher } = makeDispatcher();

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
    const { dispatcher } = makeDispatcher();

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
    const { dispatcher } = makeDispatcher();

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

  it('prompts for missing required slash/CLI params before schema parse', async () => {
    const prompts: string[] = [];
    const questionService: IQuestionService = {
      input: async (request) => {
        prompts.push(request.message);
        return '/tmp';
      },
      confirm: async () => true,
      select: async () => 'unused',
      password: async () => 'unused',
      checklist: async () => [],
    };

    const { dispatcher, registry } = makeDispatcher(questionService);

    const schema = z.object({ path: z.string().min(1) });

    const command: ICommand<{ path: string }, { path: string }> = {
      metadata: {
        key: 'can',
        description: 'check path access',
        availableIn: { chat: true, cli: true },
        parameters: schema,
      },
      execute: async (payload) => ({ status: 'ok', message: '', data: { path: payload.path } }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('can', '', { invocationSurface: 'chat', history: [] });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ path: '/tmp' });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('/can');
    expect(prompts[0]).toContain("'path'");
  });

  it('does not prompt for tool surface when required params are missing', async () => {
    const questionService: IQuestionService = {
      input: async () => '/tmp',
      confirm: async () => true,
      select: async () => 'unused',
      password: async () => 'unused',
      checklist: async () => [],
    };

    const { dispatcher, registry } = makeDispatcher(questionService);

    const schema = z.object({ path: z.string().min(1) });

    const command: ICommand<{ path: string }, { path: string }> = {
      metadata: {
        key: 'can-tool',
        group: 'access',
        description: 'check path access',
        availableIn: { tool: true },
        parameters: schema,
      },
      execute: async (payload) => ({ status: 'ok', message: '', data: { path: payload.path } }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('access-can-tool', '', {
      invocationSurface: 'tool',
      history: [],
    });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('COMMAND_DISPATCH_FAILED');
  });
});
