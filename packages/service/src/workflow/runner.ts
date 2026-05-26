import { randomUUID } from 'node:crypto';
import type { RuntimeStreamEvent } from '@ai-team/api-contracts';
import type { ExecutionContext, ICommand, CommandResponse, IServiceContainer } from '@ai-team/core';
import type { WorkflowDefinition, WorkflowResult, WorkflowStep } from './types.js';
import { WorkflowAbortError } from './types.js';
import { NoopWorkflowService, type IWorkflowService } from './workflow-service.js';
import type { ToolManager } from '../tools/tool-manager.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Minimal callable contract used by the runner.
 * Parameter types are intentionally wide — type safety is enforced by
 * `WorkflowCommandStep.params`, not by this boundary.
 */
export interface IWorkflowLocalCommand {
  execute(params: any, ctx?: any): Promise<unknown>;
}

export interface WorkflowRunOptions {
  signal?: AbortSignal;
  workflowService?: IWorkflowService;
  emit?: (event: RuntimeStreamEvent) => void;
  executionContext?: ExecutionContext;
  /** Local commands for this run only. Checked before the scoped ToolManager. */
  commands?: Record<string, IWorkflowLocalCommand>;
}

export interface IWorkflowRunner {
  run<TState>(
    definition: WorkflowDefinition<TState>,
    initialState: TState,
    options?: WorkflowRunOptions
  ): Promise<WorkflowResult<TState>>;
}

// ─── WorkflowRunner ───────────────────────────────────────────────────────────

/**
 * Executes a workflow definition step by step.
 *
 * Every step is either:
 *   - `WorkflowCommandStep` — dispatched through the scoped ToolManager
 *   - `WorkflowExecuteStep` — inline function (temporary; prefer promoting to a command)
 *
 * `workflowId`, `workflowInstanceId`, and `stepId` are stamped into the
 * ExecutionContext before each step so any dispatched command can read them.
 *
 * Sub-workflows nest naturally: each `run()` creates a child scope, so a step
 * that calls `new WorkflowRunner(container).run(...)` gets a child of the current
 * child. Agent/session context flows through unchanged.
 */
export class WorkflowRunner implements IWorkflowRunner {
  constructor(private readonly container: IServiceContainer) {}

  async run<TState>(
    definition: WorkflowDefinition<TState>,
    initialState: TState,
    options?: WorkflowRunOptions
  ): Promise<WorkflowResult<TState>> {
    const scope = this.container.child();
    const workflowService = options?.workflowService ?? new NoopWorkflowService();
    const instanceId = `${definition.id}:${randomUUID()}`;
    const baseCtx: ExecutionContext = {
      // signal/emit from run options are the source of truth for transport concerns.
      // executionContext (if provided) can override them if already set there.
      ...(options?.signal !== undefined && { signal: options.signal }),
      ...(options?.emit !== undefined && { emit: options.emit as (event: unknown) => void }),
      ...(options?.executionContext ?? { workspaceRoot: '', history: [] }),
      workflowId: definition.id,
      workflowInstanceId: instanceId,
    };

    // Resolved lazily — execute-only workflows never touch the ToolManager.
    let toolManager: ToolManager | undefined;
    const getToolManager = (): ToolManager => {
      toolManager ??= scope.resolve<ToolManager>(COMMAND_FACTORY_TOKENS.ToolManager);
      return toolManager;
    };

    let state = initialState;

    for (const step of definition.steps) {
      if (options?.signal?.aborted) throw new Error('Workflow aborted');
      if (step.skipWhen?.(state)) continue;

      const stepCtx: ExecutionContext = { ...baseCtx, stepId: step.id };
      workflowService.emitStepFrame({ workflowId: instanceId, stepId: step.id });

      try {
        state = await this.executeStep(step, state, stepCtx, options, getToolManager);
      } catch (err) {
        if (err instanceof WorkflowAbortError) return { state, aborted: true };
        throw err;
      }

      workflowService.emitStepFrame({ workflowId: instanceId, stepId: step.id, completed: true });
    }

    return { state, aborted: false };
  }

  private async executeStep<TState>(
    step: WorkflowStep<TState>,
    state: TState,
    ctx: ExecutionContext,
    options: WorkflowRunOptions | undefined,
    getToolManager: () => ToolManager
  ): Promise<TState> {
    if ('execute' in step) {
      return step.execute(state, ctx);
    }

    const cmd = options?.commands?.[step.command] ?? getToolManager().get(step.command);
    if (!cmd) throw new Error(`WorkflowRunner: '${step.command}' not registered`);
    const raw = await cmd.execute(step.params(state), ctx);
    return step.applyResult ? step.applyResult(state, raw) : state;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates `WorkflowRunner` instances.
 * Callers receive the factory via DI and never hold the container directly.
 */
export interface IWorkflowRunnerFactory {
  create(): IWorkflowRunner;
}

export class WorkflowRunnerFactory implements IWorkflowRunnerFactory {
  constructor(private readonly container: IServiceContainer) {}

  create(): IWorkflowRunner {
    return new WorkflowRunner(this.container);
  }

  /**
   * Wraps a workflow definition as an `ICommand`.
   *
   * - `definition.prepare`  maps command params to initial state (identity fallback).
   * - `definition.toResult` extracts the result from final state (full state fallback).
   *
   * The returned command uses the definition's `id`, `description`, `availableIn`,
   * and `parameters` directly — no wrapper class needed.
   */
  asCommand<TState>(definition: WorkflowDefinition<TState>): ICommand {
    const { id, steps, prepare, toResult, ...descriptorFields } = definition;
    return {
      metadata: { ...descriptorFields, key: id },
      execute: (params: unknown, ctx: ExecutionContext): Promise<CommandResponse<unknown>> =>
        this.#runAsCommand(definition, params, ctx),
    };
  }

  async #runAsCommand<TState>(
    definition: WorkflowDefinition<TState>,
    params: unknown,
    ctx: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const initialState = definition.prepare ? definition.prepare(params) : (params as TState);
    const result = await this.create().run(definition, initialState, { executionContext: ctx });
    if (result.aborted) return { status: 'error', message: 'Workflow aborted' };
    const data = definition.toResult ? definition.toResult(result.state) : result.state;
    return { status: 'ok', data };
  }
}
