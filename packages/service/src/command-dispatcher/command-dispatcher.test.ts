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

  it('validates payload schema in dispatchCommand(command, payload)', async () => {
    const { dispatcher } = makeDispatcher();

    const command: ICommand<{ message: string }, { echoed: string }> = {
      metadata: {
        key: 'typed-echo-validated',
        description: 'typed echo validated',
        availableIn: { cli: true },
        parameters: z.object({ message: z.string().min(1) }),
      },
      execute: async (payload) => ({ echoed: payload.message }),
    };

    dispatcher.registerCommand(command);

    const result = await dispatcher.dispatchCommand(command, {} as { message: string });

    expect(result.status).toBe('error');
    expect(result.message).toContain('expected string');
  });

  it('validates payload schema in dispatch({ command, payload }) overload', async () => {
    const { dispatcher, registry } = makeDispatcher();

    const command: ICommand<{ message: string }, { echoed: string }> = {
      metadata: {
        key: 'request-validated',
        description: 'request validated',
        availableIn: { cli: true, chat: true },
        parameters: z.object({ message: z.string().min(1) }),
      },
      execute: async (payload) => ({
        status: 'ok',
        message: '',
        data: { echoed: payload.message },
      }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch({
      command: 'request-validated',
      payload: {},
    });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('COMMAND_DISPATCH_FAILED');
  });

  it('auto-fills missing schema properties from execution context in dispatchByKey path', async () => {
    const { dispatcher, registry } = makeDispatcher();

    const command: ICommand<{ sessionId: string; message: string }, { sessionId: string }> = {
      metadata: {
        key: 'ctx-fill-session',
        description: 'ctx-fill-session',
        availableIn: { cli: true, chat: true },
        parameters: z.object({
          sessionId: z.string().min(1),
          message: z.string().min(1),
        }),
      },
      execute: async (payload) => ({
        status: 'ok',
        message: '',
        data: { sessionId: payload.sessionId },
      }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch(
      'ctx-fill-session',
      { message: 'hello' },
      { history: [], sessionId: 'session-from-ctx' }
    );

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ sessionId: 'session-from-ctx' });
  });

  it('auto-fills missing schema properties from context in request-overload path', async () => {
    const { dispatcher, registry } = makeDispatcher();

    const command: ICommand<{ agentId: string; message: string }, { agentId: string }> = {
      metadata: {
        key: 'ctx-fill-agent',
        description: 'ctx-fill-agent',
        availableIn: { cli: true, chat: true },
        parameters: z.object({
          agentId: z.string().min(1),
          message: z.string().min(1),
        }),
      },
      execute: async (payload) => ({
        status: 'ok',
        message: '',
        data: { agentId: payload.agentId },
      }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch(
      {
        command: 'ctx-fill-agent',
        payload: { message: 'hello' },
      },
      { history: [], agentId: 'agent-from-ctx' }
    );

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ agentId: 'agent-from-ctx' });
  });

  it('prefers payload value over context value when payload field is defined', async () => {
    const { dispatcher, registry } = makeDispatcher();

    const command: ICommand<{ sessionId: string; message: string }, { sessionId: string }> = {
      metadata: {
        key: 'ctx-override-defined',
        description: 'ctx-override-defined',
        availableIn: { cli: true, chat: true },
        parameters: z.object({
          sessionId: z.string().min(1),
          message: z.string().min(1),
        }),
      },
      execute: async (payload) => ({
        status: 'ok',
        message: '',
        data: { sessionId: payload.sessionId },
      }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch(
      'ctx-override-defined',
      { message: 'hello', sessionId: 'session-from-payload' },
      { history: [], sessionId: 'session-from-ctx' }
    );

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ sessionId: 'session-from-payload' });
  });

  it('keeps context value when payload field is explicitly undefined', async () => {
    const { dispatcher, registry } = makeDispatcher();

    const command: ICommand<{ agentId: string; message: string }, { agentId: string }> = {
      metadata: {
        key: 'ctx-override-undefined',
        description: 'ctx-override-undefined',
        availableIn: { cli: true, chat: true },
        parameters: z.object({
          agentId: z.string().min(1),
          message: z.string().min(1),
        }),
      },
      execute: async (payload) => ({
        status: 'ok',
        message: '',
        data: { agentId: payload.agentId },
      }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch(
      'ctx-override-undefined',
      { message: 'hello', agentId: undefined },
      { history: [], agentId: 'agent-from-ctx' }
    );

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ agentId: 'agent-from-ctx' });
  });

  it('uses workflowInputBindings before prompting for missing required fields', async () => {
    const prompts: string[] = [];
    const questionService: IQuestionService = {
      input: async (request) => {
        prompts.push(request.message);
        return 'should-not-be-used';
      },
      confirm: async () => true,
      select: async () => 'unused',
      password: async () => 'unused',
      checklist: async () => [],
    };

    const { dispatcher, registry } = makeDispatcher(questionService);

    const command: ICommand<{ path: string }, { path: string }> = {
      metadata: {
        key: 'workflow-bound-param',
        description: 'workflow-bound-param',
        availableIn: { chat: true, cli: true },
        parameters: z.object({ path: z.string().min(1) }),
        workflowInputBindings: {
          path: { fromLastResult: 'selected.path' },
        },
      },
      execute: async (payload) => ({ status: 'ok', message: '', data: { path: payload.path } }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch(
      'workflow-bound-param',
      {},
      {
        invocationSurface: 'slash',
        history: [],
        workflowLastResult: {
          selected: {
            path: '/from-workflow',
          },
        },
      }
    );

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ path: '/from-workflow' });
    expect(prompts).toHaveLength(0);
  });

  it('maps positional string args into required schema fields for slash/chat dispatch', async () => {
    const prompts: string[] = [];
    const questionService: IQuestionService = {
      input: async (request) => {
        prompts.push(request.message);
        return 'unused';
      },
      confirm: async () => true,
      select: async () => 'unused',
      password: async () => 'unused',
      checklist: async () => [],
    };

    const { dispatcher, registry } = makeDispatcher(questionService);

    const command: ICommand<{ path: string }, { path: string }> = {
      metadata: {
        key: 'path-check',
        description: 'path-check',
        availableIn: { chat: true, cli: true },
        parameters: z.object({ path: z.string().min(1) }),
      },
      execute: async (payload) => ({ status: 'ok', message: '', data: { path: payload.path } }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('path-check', '/tmp/my-file.txt', {
      invocationSurface: 'slash',
      history: [],
    });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ path: '/tmp/my-file.txt' });
    expect(prompts).toHaveLength(0);
  });

  it('maps positional string args in request-overload dispatch for CLI-like entry', async () => {
    const { dispatcher, registry } = makeDispatcher();

    const command: ICommand<{ agentId: string; sessionId: string }, { value: string }> = {
      metadata: {
        key: 'resume-session',
        description: 'resume-session',
        availableIn: { chat: true, cli: true },
        parameters: z.object({
          agentId: z.string().min(1),
          sessionId: z.string().min(1),
        }),
      },
      execute: async (payload) => ({
        status: 'ok',
        message: '',
        data: { value: `${payload.agentId}:${payload.sessionId}` },
      }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch(
      {
        command: 'resume-session',
        payload: 'michael-brown sess-123',
      },
      { invocationSurface: 'cli', history: [] }
    );

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ value: 'michael-brown:sess-123' });
  });

  it('folds extra positional words into the last mapped schema field', async () => {
    const { dispatcher, registry } = makeDispatcher();

    const command: ICommand<{ targetAgentId: string; briefingNote?: string }, { value: string }> = {
      metadata: {
        key: 'handoff-like',
        description: 'handoff-like',
        availableIn: { chat: true, cli: true },
        parameters: z.object({
          targetAgentId: z.string().min(1),
          briefingNote: z.string().optional(),
        }),
      },
      execute: async (payload) => ({
        status: 'ok',
        message: '',
        data: { value: `${payload.targetAgentId}|${payload.briefingNote ?? ''}` },
      }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('handoff-like', 'michael-brown please review auth flow', {
      invocationSurface: 'chat',
      history: [],
    });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ value: 'michael-brown|please review auth flow' });
  });

  it('does not prompt for fields that are required in JSON schema but have defaults', async () => {
    const prompts: string[] = [];
    const questionService: IQuestionService = {
      input: async (request) => {
        prompts.push(request.message);
        return 'unused';
      },
      confirm: async () => true,
      select: async () => 'unused',
      password: async () => 'unused',
      checklist: async () => [],
    };

    const { dispatcher, registry } = makeDispatcher(questionService);

    const command: ICommand<
      { targetAgentId: string; briefingNote: string; retries: number },
      { value: string }
    > = {
      metadata: {
        key: 'defaulted-required',
        description: 'defaulted-required',
        availableIn: { chat: true, cli: true },
        parameters: z.object({
          targetAgentId: z.string().min(1),
          briefingNote: z.string().default('auto-briefing'),
          retries: z.number().int().default(3),
        }),
      },
      execute: async (payload) => ({
        status: 'ok',
        message: '',
        data: { value: `${payload.targetAgentId}|${payload.briefingNote}|${payload.retries}` },
      }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('defaulted-required', 'michael-brown', {
      invocationSurface: 'slash',
      history: [],
    });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ value: 'michael-brown|auto-briefing|3' });
    expect(prompts).toHaveLength(0);
  });
});
