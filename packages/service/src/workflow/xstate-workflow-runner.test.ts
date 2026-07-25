import { describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type {
  IBackendLogService,
  IServiceContainer,
  IWorkflowRunRepository,
  WorkflowRunRecord,
} from '@ai-team/core';
import { CORE_SERVICE_TOKENS } from '@ai-team/core';
import { CommandActorAdapterResolver } from './command-actor-adapter-resolver.js';
import { WORKFLOW_SERVICE_TOKENS } from './workflow-service-tokens.js';
import { WorkflowRunner, WorkflowRunnerFactory } from './xstate-workflow-runner.js';
import type { WorkflowDefinition } from './workflow-types.js';

interface LoopState {
  count: number;
}

const noOpBackendLogService: IBackendLogService = {
  write: () => {},
};

class MemoryWorkflowRunRepository implements IWorkflowRunRepository {
  readonly records = new Map<string, WorkflowRunRecord>();

  async save(record: WorkflowRunRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }

  async get(runId: string): Promise<WorkflowRunRecord | null> {
    const record = this.records.get(runId);
    return record ? structuredClone(record) : null;
  }

  async findActiveBySession(sessionId: string): Promise<WorkflowRunRecord | null> {
    return (
      [...this.records.values()].find(
        (record) => record.status === 'active' && record.activeSessionId === sessionId
      ) ?? null
    );
  }
}

function createResolver(
  backendLogService?: IBackendLogService,
  workflowRunRepository?: IWorkflowRunRepository,
  commands: Record<string, unknown> = {},
  commandActorAdapters?: CommandActorAdapterResolver
): IServiceContainer {
  const toolManager = {
    get: (key: string) => commands[key],
  };

  const resolver = {
    resolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.ToolManager) {
        return toolManager;
      }
      if (token === CORE_SERVICE_TOKENS.BackendLogService) {
        return backendLogService ?? noOpBackendLogService;
      }
      if (token === CORE_SERVICE_TOKENS.WorkflowRunRepository && workflowRunRepository) {
        return workflowRunRepository;
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
      if (token === CORE_SERVICE_TOKENS.WorkflowRunRepository) {
        return workflowRunRepository;
      }
      if (token === WORKFLOW_SERVICE_TOKENS.CommandActorAdapterResolver) {
        return commandActorAdapters;
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
  it('starts a durable run through the factory and keeps run() as its completion wrapper', async () => {
    const repository = new MemoryWorkflowRunRepository();
    const runner = new WorkflowRunnerFactory(createResolver(undefined, repository)).create();
    const definition: WorkflowDefinition<{ count: number }> = {
      id: 'durable-runner-start',
      version: '2026.7',
      description: 'Durable workflow runner start test',
      availableIn: { cli: false, chat: false, tool: false },
      steps: [
        {
          id: 'increment',
          command: 'increment',
          applyResult: (state, raw) => ({ ...state, count: Number(raw) }),
        },
      ],
    };

    const handle = await runner.start(definition, { count: 0 }, {
      executionContext: { history: [], sessionId: 'session-durable-runner' },
      commands: { increment: { execute: async () => 1 } },
    });

    await expect(handle.waitForDone()).resolves.toEqual({ state: { count: 1 }, aborted: false });
    expect(handle.id).toMatch(/^durable-runner-start:/);
    expect([...repository.records.values()]).toEqual([
      expect.objectContaining({
        id: handle.id,
        status: 'completed',
        definitionId: 'durable-runner-start',
        definitionVersion: '2026.7',
        activeSessionId: 'session-durable-runner',
      }),
    ]);
  });

  it('invokes a branded workflow command as a child actor instead of calling execute()', async () => {
    const childDefinition: WorkflowDefinition<{ value: string }> = {
      id: 'child-workflow-command',
      version: '1',
      description: 'Child workflow command actor test',
      availableIn: { cli: false, chat: false, tool: true },
      toResult: (state) => ({ completed: state.value }),
      steps: [
        {
          id: 'set-value',
          execute: async () => ({ value: 'from-child' }),
        },
      ],
    };
    const commands: Record<string, unknown> = {};
    const commandActorAdapters = new CommandActorAdapterResolver();
    const factory = new WorkflowRunnerFactory(
      createResolver(undefined, undefined, commands, commandActorAdapters)
    );
    const childCommand = factory.asCommand(childDefinition);
    commands.child_workflow = childCommand;
    const execute = vi.spyOn(childCommand, 'execute');
    const runner = factory.create();

    const result = await runner.run(
      {
        id: 'parent-workflow-command',
        version: '1',
        description: 'Parent invokes a workflow command',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [
          {
            id: 'invoke-child',
            command: 'child_workflow',
            applyResult: (state, raw) => ({ ...state, child: raw }),
          },
        ],
      },
      {}
    );

    expect(result).toEqual({ state: { child: { completed: 'from-child' } }, aborted: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps host dependencies out of persisted workflow context', () => {
    const runner = new WorkflowRunner(createResolver(undefined), noOpBackendLogService);
    const machine = (runner as any).compileMachine(
      {
        id: 'serializable-workflow-context',
        description: 'Ensure actor snapshots only retain workflow state.',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [],
      },
      {
        container: createResolver(undefined),
        options: { commands: {} },
      }
    );
    const actor = createActor(machine, {
      input: {
        initialState: { ready: true },
        workflowId: 'serializable-workflow-context',
        workflowInstanceId: 'serializable-workflow-context:1',
      },
    }).start();

    const context = actor.getPersistedSnapshot().context as Record<string, unknown>;

    expect(context).toMatchObject({
      state: { ready: true },
      workflowId: 'serializable-workflow-context',
      workflowInstanceId: 'serializable-workflow-context:1',
    });
    expect(context).not.toHaveProperty('container');
    expect(context).not.toHaveProperty('options');
    expect(JSON.stringify(actor.getPersistedSnapshot())).not.toContain('ToolManager');
  });

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

  it('returns and logs the original step failure when XState reaches its aborted final state', async () => {
    const write = vi.fn();
    const backendLogService: IBackendLogService = { write };
    const runner = new WorkflowRunner(createResolver(backendLogService), backendLogService);

    const result = await runner.run(
      {
        id: 'failing-step-workflow',
        description: 'Step failure diagnostics test',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [{ id: 'explode', command: 'explode' }],
      },
      { count: 0 },
      {
        commands: {
          explode: {
            execute: async () => {
              throw new Error('Database connection failed.');
            },
          },
        },
      }
    );

    expect(result.aborted).toBe(true);
    expect(result.abortedError).toContain("step 'explode'");
    expect(result.abortedError).toContain('Database connection failed.');
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'workflow-runner',
        level: 'error',
        phase: 'workflow-aborted',
        workflowId: 'failing-step-workflow',
        stepId: 'explode',
        error: expect.stringContaining('Database connection failed.'),
      })
    );
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
    const write = vi.fn();
    const backendLogService: IBackendLogService = { write };
    const runner = new WorkflowRunner(createResolver(backendLogService), backendLogService);
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
    expect(result.abortedError).toMatch(
      /^Execution of workflow 'workflow-abort-hanging-command' \(run .+\) was interrupted: Target agent LLM request timed out\.$/
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'workflow-runner',
        level: 'error',
        phase: 'workflow-aborted',
        workflowId: 'workflow-abort-hanging-command',
        error: expect.stringContaining('Target agent LLM request timed out.'),
      })
    );
  });

  it('explains when a workflow receives an already-aborted request signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = new WorkflowRunner(createResolver(undefined), noOpBackendLogService);

    const result = await runner.run(
      {
        id: 'already-aborted-workflow',
        description: 'Already aborted signal test',
        availableIn: { cli: false, chat: false, tool: false },
        steps: [{ id: 'noop', command: 'noop' }],
      },
      { count: 0 },
      {
        signal: controller.signal,
        commands: {
          noop: { execute: vi.fn(async () => undefined) },
        },
      }
    );

    expect(result.aborted).toBe(true);
    expect(result.abortedError).toMatch(
      /^Could not start workflow 'already-aborted-workflow' \(run .+\): the request signal was already aborted\.$/
    );
  });
});
