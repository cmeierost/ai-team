import { describe, expect, it, vi } from 'vitest';
import type { IBackendLogService, IServiceContainer } from '@ai-team/core';
import { CORE_SERVICE_TOKENS } from '@ai-team/core';
import { WorkflowRunner } from './xstate-workflow-runner.js';
import type { WorkflowDefinition } from './workflow-types.js';

interface LoopState {
  count: number;
}

const noOpBackendLogService: IBackendLogService = {
  write: () => {},
};

function createResolver(backendLogService?: IBackendLogService): IServiceContainer {
  const toolManager = {
    get: () => undefined,
  };

  const resolver = {
    resolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.ToolManager) {
        return toolManager;
      }
      if (token === CORE_SERVICE_TOKENS.BackendLogService) {
        return backendLogService ?? noOpBackendLogService;
      }
      throw new Error(`Unexpected token: ${String(token)}`);
    },
    tryResolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.BackendLogService) {
        return backendLogService ?? noOpBackendLogService;
      }
      if (token === CORE_SERVICE_TOKENS.ToolManager) {
        return toolManager;
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
  };

  return resolver as unknown as IServiceContainer;
}

function createLoopDefinition(): WorkflowDefinition<LoopState> {
  return {
    id: 'workflow-logger-loop',
    description: 'Workflow runner loop logging test',
    availableIn: { cli: false, chat: false, tool: false },
    steps: [
      {
        kind: 'loop',
        id: 'repeat',
        while: 'count != 2',
        steps: [
          {
            id: 'inc',
            command: 'inc',
            params: (state) => ({ count: state.count }),
            applyResult: (state, raw) => ({
              ...state,
              count: Number(raw),
            }),
          },
        ],
      },
    ],
  };
}

describe('WorkflowRunner logging', () => {
  it('exposes the workflow return command and parent frame to step commands', async () => {
    const execute = vi.fn(async (_params: unknown, ctx: any) => {
      expect(ctx.workflowReturn).toEqual({
        command: 'session-handoff-return',
        args: { reason: 'completed' },
      });
      expect(ctx.workflowStack).toEqual([
        {
          workflowId: 'parent-workflow',
          workflowInstanceId: 'parent-1',
          agentId: 'emily-davis',
          sessionId: 'session-emily',
        },
      ]);
      return { status: 'ok', data: 'done' };
    });
    const runner = new WorkflowRunner(createResolver(undefined), noOpBackendLogService);

    const result = await runner.run(
      {
        id: 'child-workflow',
        description: 'Workflow with a configurable return command',
        availableIn: { cli: false, chat: false, tool: false },
        return: {
          command: 'session-handoff-return',
          args: { reason: 'completed' },
        },
        steps: [{ id: 'work', command: 'work' }],
      },
      {},
      {
        executionContext: {
          history: [],
          workflowId: 'parent-workflow',
          workflowInstanceId: 'parent-1',
          agentId: 'emily-davis',
          sessionId: 'session-emily',
        },
        commands: {
          work: { execute },
        },
      }
    );

    expect(result.aborted).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('exposes the previous command response as the default workflow return value', async () => {
    const firstResult = {
      status: 'ok',
      message: 'Analysis completed.',
      data: { answer: 42 },
    };
    const inspect = vi.fn(async (_params: unknown, ctx: any) => {
      expect(ctx.workflowReturn).toBeUndefined();
      expect(ctx.workflowLastResult).toEqual(firstResult);
      return { status: 'ok', data: 'inspected' };
    });
    const runner = new WorkflowRunner(createResolver(undefined), noOpBackendLogService);

    const result = await runner.run(
      {
        id: 'default-return-workflow',
        description: 'Workflow using its previous tool response as the return value',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [
          { id: 'analyze', command: 'analyze' },
          { id: 'inspect', command: 'inspect' },
        ],
      },
      {},
      {
        commands: {
          analyze: { execute: vi.fn(async () => firstResult) },
          inspect: { execute: inspect },
        },
      }
    );

    expect(result.aborted).toBe(false);
    expect(inspect).toHaveBeenCalledOnce();
  });

  it('writes debug logs for workflow steps and loop checks', async () => {
    const write = vi.fn();
    const backendLogService: IBackendLogService = { write };
    const runner = new WorkflowRunner(createResolver(backendLogService), backendLogService);

    const result = await runner.run(
      createLoopDefinition(),
      { count: 0 },
      {
        commands: {
          inc: {
            execute: async (params: unknown) => {
              const count = Number((params as { count: number }).count);
              return count + 1;
            },
          },
        },
      }
    );

    expect(result.aborted).toBe(false);
    expect(result.state.count).toBe(2);

    const entries = write.mock.calls.map(([entry]) => entry as Record<string, unknown>);

    expect(entries.some((entry) => entry.phase === 'run-start')).toBe(true);
    expect(
      entries.some((entry) => entry.phase === 'command-start' && entry.stepId === 'repeat_inc')
    ).toBe(true);
    expect(
      entries.some((entry) => entry.phase === 'command-complete' && entry.stepId === 'repeat_inc')
    ).toBe(true);

    const loopChecks = entries.filter(
      (entry) => entry.phase === 'loop-check' && entry.stepId === 'repeat'
    );
    expect(loopChecks.length).toBeGreaterThanOrEqual(2);
  });

  it('runs successfully when no backend logger is registered', async () => {
    const runner = new WorkflowRunner(createResolver(undefined), noOpBackendLogService);

    const result = await runner.run(
      {
        id: 'workflow-no-logger',
        description: 'Workflow runner without logger test',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [
          {
            id: 'inc',
            command: 'inc',
            params: (state: LoopState) => ({ count: state.count }),
            applyResult: (state: LoopState, raw: unknown) => ({
              ...state,
              count: Number(raw),
            }),
          },
        ],
      },
      { count: 0 },
      {
        commands: {
          inc: {
            execute: async (params: unknown) => {
              const count = Number((params as { count: number }).count);
              return count + 1;
            },
          },
        },
      }
    );

    expect(result.aborted).toBe(false);
    expect(result.state.count).toBe(1);
  });

  it('honors skipWhen in loop body command steps', async () => {
    const execute = vi.fn(async (params: unknown) => {
      const count = Number((params as { count: number }).count);
      return count + 1;
    });

    const runner = new WorkflowRunner(createResolver(undefined), noOpBackendLogService);

    const result = await runner.run(
      {
        id: 'workflow-loop-skip-when',
        description: 'Loop body skipWhen regression test',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [
          {
            kind: 'loop',
            id: 'repeat',
            while: 'count != 1',
            maxIterations: 3,
            steps: [
              {
                id: 'inc',
                command: 'inc',
                skipWhen: 'true',
                params: (state: LoopState) => ({ count: state.count }),
                applyResult: (state: LoopState, raw: unknown) => ({
                  ...state,
                  count: Number(raw),
                }),
              },
            ],
          },
        ],
      },
      { count: 0 },
      {
        commands: {
          inc: {
            execute,
          },
        },
      }
    );

    expect(result.aborted).toBe(false);
    expect(result.state.count).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('aborts a hanging workflow when signal is aborted', async () => {
    const runner = new WorkflowRunner(createResolver(undefined), noOpBackendLogService);
    const controller = new AbortController();

    const runPromise = runner.run(
      {
        id: 'workflow-abort-hanging-command',
        description: 'Abort hanging command test',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [
          {
            id: 'waitForever',
            command: 'waitForever',
          },
        ],
      },
      { count: 0 },
      {
        signal: controller.signal,
        commands: {
          waitForever: {
            execute: async () => await new Promise(() => {}),
          },
        },
      }
    );

    setTimeout(() => controller.abort(new Error('Target agent LLM request timed out.')), 20);

    const result = await Promise.race([
      runPromise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('abort timeout')), 500);
      }),
    ]);

    expect(result.aborted).toBe(true);
    expect(result.state.count).toBe(0);
    expect(result.abortedError).toBe('Target agent LLM request timed out.');
  });
});
