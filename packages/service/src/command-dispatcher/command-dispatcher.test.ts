import { describe, expect, it, vi } from 'vitest';
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
  it('does not wrap a command response that omits its optional message', async () => {
    const { dispatcher, registry } = makeDispatcher();
    const data = { path: '.', tree: { name: 'root' } };
    const command: ICommand<Record<string, never>, typeof data> = {
      metadata: {
        key: 'message-less',
        description: 'returns a response without a message',
        availableIn: { chat: true },
        group: 'system',
        parameters: z.object({}),
      },
      execute: async () => ({ status: 'ok', data }),
    };
    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('system-message-less', '', {
      invocationSurface: 'slash',
      history: [],
    });

    expect(result).toEqual({ status: 'ok', message: '', data });
  });

  it('normalizes positional and JSON variadic input to the same parameter object', async () => {
    const { dispatcher, registry } = makeDispatcher();
    const parameters = z.object({
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
    });
    const command: ICommand<
      { command: string; args?: string[] },
      { command: string; args?: string[] }
    > = {
      metadata: {
        key: 'structured-variadic',
        usage: '/structured-variadic <command> [args...]',
        description: 'accepts an executable followed by any number of arguments',
        availableIn: { chat: true },
        parameters,
        input: {
          mode: 'structured',
          variadicParameter: 'args',
          jsonSignature: true,
        },
      },
      execute: async (params) => ({
        status: 'ok',
        message: '',
        data: params,
      }),
    };

    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const positional = await dispatcher.dispatch(
      'structured-variadic',
      'git status --short "folder with spaces" ""',
      { invocationSurface: 'slash', history: [] }
    );
    const json = await dispatcher.dispatch(
      'structured-variadic',
      JSON.stringify({
        command: 'git',
        args: ['status', '--short', 'folder with spaces', ''],
      }),
      { invocationSurface: 'slash', history: [] }
    );

    const expected = {
      command: 'git',
      args: ['status', '--short', 'folder with spaces', ''],
    };
    expect(positional.status).toBe('ok');
    expect(positional.data).toEqual(expected);
    expect(json.status).toBe('ok');
    expect(json.data).toEqual(expected);
  });

  it('rejects malformed positional quoting before command execution', async () => {
    const { dispatcher, registry } = makeDispatcher();
    const execute = vi.fn();
    const command: ICommand<
      { command: string; args?: string[] },
      { command: string; args?: string[] }
    > = {
      metadata: {
        key: 'quoted-variadic',
        description: 'quoted variadic input',
        availableIn: { chat: true },
        parameters: z.object({
          command: z.string().min(1),
          args: z.array(z.string()).optional(),
        }),
        input: { mode: 'structured', variadicParameter: 'args' },
      },
      execute,
    };
    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('quoted-variadic', 'git "unterminated', {
      invocationSurface: 'slash',
      history: [],
    });

    expect(result.status).toBe('error');
    expect(result.message).toContain('Unterminated double quote');
    expect(execute).not.toHaveBeenCalled();
  });

  it('derives required context fields before final schema validation', async () => {
    const { dispatcher, registry } = makeDispatcher();
    const command: ICommand<
      { sessionId: string; query: string },
      { sessionId: string; query: string }
    > = {
      metadata: {
        key: 'context-before-validation',
        description: 'fills session from context',
        availableIn: { chat: true },
        parameters: z.object({
          sessionId: z.string().min(1),
          query: z.string().min(1),
        }),
        input: { contextParameters: ['sessionId'], jsonSignature: true },
      },
      execute: async (params) => ({
        status: 'ok',
        message: '',
        data: params,
      }),
    };
    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch(
      'context-before-validation',
      '{"query":"status"}',
      { invocationSurface: 'slash', history: [], sessionId: 'session-1' }
    );

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({
      sessionId: 'session-1',
      query: 'status',
    });
  });

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

  it('preserves a typed cancelled command response instead of wrapping it as ok', async () => {
    const { dispatcher } = makeDispatcher();
    const cancellation = {
      type: 'handoff_cancelled' as const,
      outcome: 'cancelled' as const,
      targetAgentId: 'sarah-lee',
      reasonCode: 'approval-denied' as const,
      message: 'Handoff was not approved.',
      timestamp: '2026-07-23T18:00:00.000Z',
    };

    const command: ICommand<Record<string, never>, typeof cancellation> = {
      metadata: {
        key: 'typed-cancelled',
        description: 'typed cancelled response',
        availableIn: { chat: true },
      },
      execute: async () => ({
        status: 'cancelled',
        message: cancellation.message,
        data: cancellation,
      }),
    };

    dispatcher.registerCommand(command);

    const result = await dispatcher.dispatchCommand(command, {});

    expect(result).toEqual({
      status: 'cancelled',
      message: cancellation.message,
      data: cancellation,
    });
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

  it('parses a prompted variadic invocation through the normal command input mapping', async () => {
    const prompts: string[] = [];
    const questionService: IQuestionService = {
      input: async (request) => {
        prompts.push(request.message);
        return 'git status';
      },
      confirm: async () => true,
      select: async () => 'unused',
      password: async () => 'unused',
      checklist: async () => [],
    };
    const { dispatcher, registry } = makeDispatcher(questionService);
    const command: ICommand<
      { command: string; args: string[] },
      { command: string; args: string[] }
    > = {
      metadata: {
        key: 'run',
        description: 'run a command',
        availableIn: { chat: true },
        parameters: z.object({
          command: z.string().min(1),
          args: z.array(z.string()).default([]),
        }),
        input: {
          mode: 'structured',
          variadicParameter: 'args',
          jsonSignature: true,
        },
        help: {
          examples: [{ value: 'git status', surfaces: ['chat'] }],
        },
      },
      execute: async (params) => ({ status: 'ok', message: '', data: params }),
    };
    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('run', '', {
      invocationSurface: 'slash',
      history: [],
    });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ command: 'git', args: ['status'] });
    expect(prompts).toEqual([
      expect.stringContaining('git status'),
    ]);
  });

  it('asks only for required fields still missing after partial JSON input and context derivation', async () => {
    const prompts: string[] = [];
    const questionService: IQuestionService = {
      input: async (request) => {
        prompts.push(request.message);
        return 'derived-by-question';
      },
      confirm: async () => true,
      select: async () => 'unused',
      password: async () => 'unused',
      checklist: async () => [],
    };
    const { dispatcher, registry } = makeDispatcher(questionService);
    const command: ICommand<
      { agentId: string; sessionId: string; query: string },
      { agentId: string; sessionId: string; query: string }
    > = {
      metadata: {
        key: 'complete-partial',
        description: 'complete partial parameters',
        availableIn: { chat: true },
        parameters: z.object({
          agentId: z.string().min(1),
          sessionId: z.string().min(1),
          query: z.string().min(1),
        }),
        input: { contextParameters: ['agentId', 'sessionId'], jsonSignature: true },
      },
      execute: async (params) => ({ status: 'ok', message: '', data: params }),
    };
    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('complete-partial', '{"query":"status"}', {
      invocationSurface: 'slash',
      history: [],
      sessionId: 'session-1',
    });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({
      agentId: 'derived-by-question',
      sessionId: 'session-1',
      query: 'status',
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("'agentId'");
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

  it('uses declared workflow data before prompting and final validation', async () => {
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
    const command: ICommand<{ targetAgentId: string }, { targetAgentId: string }> = {
      metadata: {
        key: 'workflow-data-bound-param',
        description: 'workflow-data-bound-param',
        availableIn: { chat: true },
        parameters: z.object({ targetAgentId: z.string().min(1) }),
        workflowInputBindings: {
          targetAgentId: { fromWorkflowData: 'handoff.targetAgentId' },
        },
      },
      execute: async (params) => ({ status: 'ok', message: '', data: params }),
    };
    registry.register(command.metadata, () => command as ICommand<unknown, unknown>);

    const result = await dispatcher.dispatch('workflow-data-bound-param', '{}', {
      invocationSurface: 'slash',
      history: [],
      workflowState: {
        handoff: {
          targetAgentId: 'alex-morgan',
        },
      },
    });

    expect(result.status).toBe('ok');
    expect(result.data).toEqual({ targetAgentId: 'alex-morgan' });
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

    const result = await dispatcher.dispatch(
      'handoff-like',
      'michael-brown please review auth flow',
      {
        invocationSurface: 'chat',
        history: [],
      }
    );

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
