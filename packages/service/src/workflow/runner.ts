import { randomUUID } from 'node:crypto';
import type {
  RuntimeStreamEvent,
  WorkflowDefinitionApiResponse,
  WorkflowDefinitionDocument,
} from '@ai-team/api-contracts';
import type {
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  CommandResponse,
  IServiceContainer,
} from '@ai-team/core';
import type {
  WorkflowCommandStep,
  WorkflowDefinition,
  WorkflowResult,
  WorkflowStep,
} from './types.js';
import { WorkflowAbortError } from './types.js';
import { NoopWorkflowService, type IWorkflowService } from './workflow-service.js';
import type { ToolManager } from '../tools/tool-manager.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';
import {
  evaluateWorkflowCondition,
  resolveTemplateData,
  resolveTemplateExpressions,
} from './param-resolver.js';
import { workflowDefinitionJsonToYaml } from './definition-format.js';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Minimal callable contract used by the runner.
 * Parameter types are intentionally wide — type safety is enforced by
 * `WorkflowCommandStep.args` template resolution, not by this boundary.
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
 *   - `WorkflowCommandStep` — dispatched through the scoped ToolManager with template-resolved args
 *   - `WorkflowExecuteStep` — inline function (temporary; prefer promoting to a command)
 *   - `WorkflowLoopStep` — executes child steps while a condition holds
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
    const { scope, workflowService, instanceId, baseCtx } = this.createRunContext(
      definition,
      options
    );

    let toolManager: ToolManager | undefined;
    const getToolManager = (): ToolManager => {
      toolManager ??= scope.resolve<ToolManager>(COMMAND_FACTORY_TOKENS.ToolManager);
      return toolManager;
    };

    let state = initialState;

    for (const step of definition.steps) {
      state = await this.executeTopLevelStepAsync(
        step,
        state,
        baseCtx,
        options,
        getToolManager,
        workflowService,
        instanceId
      );
    }

    return { state, aborted: false };
  }

  private createRunContext<TState>(
    definition: WorkflowDefinition<TState>,
    options: WorkflowRunOptions | undefined
  ) {
    const scope = this.container.child();
    const workflowService = options?.workflowService ?? new NoopWorkflowService();
    const instanceId = `${definition.id}:${randomUUID()}`;
    const baseCtx: ExecutionContext = {
      ...(options?.signal !== undefined && { signal: options.signal }),
      ...(options?.executionContext ?? { history: [] }),
      workflowId: definition.id,
      workflowInstanceId: instanceId,
    };
    return { scope, workflowService, instanceId, baseCtx };
  }

  private async executeTopLevelStepAsync<TState>(
    step: WorkflowStep<TState>,
    state: TState,
    baseCtx: ExecutionContext,
    options: WorkflowRunOptions | undefined,
    getToolManager: () => ToolManager,
    workflowService: IWorkflowService,
    instanceId: string
  ): Promise<TState> {
    if (options?.signal?.aborted) throw new Error('Workflow aborted');
    if (this.shouldSkipStep(step, state)) return state;

    const stepCtx: ExecutionContext = { ...baseCtx, stepId: step.id };
    workflowService.emitStepFrame({ workflowId: instanceId, stepId: step.id });

    let newState: TState;
    try {
      newState = await this.dispatchStepAsync(step, state, stepCtx, options, getToolManager);
    } catch (err) {
      if (err instanceof WorkflowAbortError) return state;
      throw err;
    }

    workflowService.emitStepFrame({ workflowId: instanceId, stepId: step.id, completed: true });
    return newState;
  }

  private async dispatchStepAsync<TState>(
    step: WorkflowStep<TState>,
    state: TState,
    ctx: ExecutionContext,
    options: WorkflowRunOptions | undefined,
    getToolManager: () => ToolManager,
    index?: number
  ): Promise<TState> {
    if ('kind' in step && step.kind === 'loop') {
      return this.executeLoopStepAsync(step, state, ctx, options, getToolManager);
    }
    return this.executeStepAsync(step, state, ctx, options, getToolManager, index);
  }

  private async executeLoopStepAsync<TState>(
    step: { kind: 'loop'; steps: WorkflowStep<TState>[]; while: string; maxIterations?: number },
    state: TState,
    ctx: ExecutionContext,
    options: WorkflowRunOptions | undefined,
    getToolManager: () => ToolManager
  ): Promise<TState> {
    const maxIterations = step.maxIterations ?? 100;
    let iteration = 0;

    while (iteration < maxIterations) {
      if (!this.evaluateLoopCondition(step.while, state as Record<string, unknown>, iteration))
        break;
      state = await this.executeLoopBodyAsync(
        step.steps,
        state,
        ctx,
        options,
        getToolManager,
        iteration
      );
      iteration++;
    }

    return state;
  }

  private evaluateLoopCondition(
    condition: string,
    state: Record<string, unknown>,
    index: number
  ): boolean {
    return evaluateWorkflowCondition(condition, state, index);
  }

  private async executeLoopBodyAsync<TState>(
    steps: WorkflowStep<TState>[],
    state: TState,
    ctx: ExecutionContext,
    options: WorkflowRunOptions | undefined,
    getToolManager: () => ToolManager,
    iteration: number
  ): Promise<TState> {
    let result = state;
    for (const childStep of steps) {
      if (options?.signal?.aborted) throw new Error('Workflow aborted');
      if (this.shouldSkipStep(childStep, result, iteration)) continue;
      result = await this.executeChildStepAsync(
        childStep,
        result,
        ctx,
        options,
        getToolManager,
        iteration
      );
    }
    return result;
  }

  private async executeChildStepAsync<TState>(
    step: WorkflowStep<TState>,
    state: TState,
    ctx: ExecutionContext,
    options: WorkflowRunOptions | undefined,
    getToolManager: () => ToolManager,
    index?: number
  ): Promise<TState> {
    return this.dispatchStepAsync(step, state, ctx, options, getToolManager, index);
  }

  private async executeStepAsync<TState>(
    step: WorkflowStep<TState>,
    state: TState,
    ctx: ExecutionContext,
    options: WorkflowRunOptions | undefined,
    getToolManager: () => ToolManager,
    index?: number
  ): Promise<TState> {
    if ('execute' in step) {
      return step.execute(state, ctx);
    }

    // At this point step is WorkflowCommandStep (loop steps are handled by dispatchStepAsync)
    const cmdStep = step as WorkflowCommandStep<TState>;
    const resolvedParams = this.resolveStepParams(cmdStep, state, index);
    const cmd = options?.commands?.[cmdStep.command] ?? getToolManager().get(cmdStep.command);
    if (!cmd) throw new Error(`WorkflowRunner: '${cmdStep.command}' not registered`);
    const raw = await cmd.execute(resolvedParams, ctx);

    if (cmdStep.applyResult) {
      return cmdStep.applyResult(state, raw);
    }

    return this.storeStepResult(state, cmdStep.id, raw);
  }

  private storeStepResult<TState>(state: TState, stepId: string, result: unknown): TState {
    const newState = { ...(state as Record<string, unknown>) };
    const existing = newState[stepId];
    newState[stepId] = Array.isArray(existing) ? [...existing, result] : result;
    return newState as TState;
  }

  private resolveStepParams<TState>(
    step: WorkflowCommandStep<TState>,
    state: TState,
    index?: number
  ): unknown {
    if (step.params) return step.params(state);
    if (step.args)
      return resolveTemplateExpressions(step.args, state as Record<string, unknown>, index);
    return {};
  }

  private shouldSkipStep<TState>(
    step: WorkflowStep<TState>,
    state: TState,
    index?: number
  ): boolean {
    if (step.skipWhen?.(state)) return true;
    if (!('when' in step) || !step.when) return false;
    return !evaluateWorkflowCondition(step.when, state as Record<string, unknown>, index);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates `WorkflowRunner` instances.
 * Callers receive the factory via DI and never hold the container directly.
 */
export interface IWorkflowRunnerFactory {
  create(): IWorkflowRunner;
  /** Wraps a workflow definition as an `ICommand` so it can be registered as a tool. */
  asCommand<TState>(definition: WorkflowDefinition<TState>): ICommand;
}

/**
 * Derive an `ICommandDescriptor` from a `WorkflowDefinition`.
 * The workflow `id` becomes the command `key`; steps and adapter hooks are dropped.
 *
 * Use when registering a workflow as a tool in a `CommandRegistry`.
 */
export function workflowDescriptor<TState>(
  definition: WorkflowDefinition<TState>
): ICommandDescriptor {
  const aliases = new Set<string>(definition.aliases ?? []);
  aliases.add(definition.id);
  aliases.add(`workflow_${definition.id}`);

  const tags = new Set<string>(definition.tags ?? []);
  tags.add('workflow-definition');

  const {
    id,
    steps: _steps,
    prepare: _prepare,
    toResult: _toResult,
    result: _result,
    aliases: _aliases,
    tags: _tags,
    ...descriptorFields
  } = definition;

  return {
    ...descriptorFields,
    key: id,
    aliases: [...aliases],
    tags: [...tags],
  };
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
    const { id, steps, prepare, toResult, result, ...descriptorFields } = definition;

    const definitionProvider = {
      getDefinition: (): WorkflowDefinitionApiResponse =>
        workflowDefinitionToApiResponse(definition),
    };

    return {
      metadata: { ...descriptorFields, key: id },
      execute: (params: unknown, ctx: ExecutionContext): Promise<CommandResponse<unknown>> =>
        this.#runAsCommand(definition, params, ctx),
      ...definitionProvider,
    };
  }

  async #runAsCommand<TState>(
    definition: WorkflowDefinition<TState>,
    params: unknown,
    ctx: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const initialState = definition.prepare ? definition.prepare(params) : (params as TState);
    const runResult = await this.create().run(definition, initialState, { executionContext: ctx });
    if (runResult.aborted) return { status: 'error', message: 'Workflow aborted' };

    let data: unknown = runResult.state;
    if (definition.result !== undefined) {
      data = resolveTemplateData(definition.result, runResult.state as Record<string, unknown>);
    }
    if (definition.toResult) {
      data = definition.toResult(runResult.state);
    }

    return { status: 'ok', data };
  }
}

function workflowDefinitionToApiResponse<TState>(
  definition: WorkflowDefinition<TState>
): WorkflowDefinitionApiResponse {
  const document = workflowDefinitionToDocument(definition);
  return {
    workflowId: definition.id,
    format: 'workflow/v1',
    definitionJson: document,
    definitionYaml: workflowDefinitionJsonToYaml(document),
  };
}

function workflowDefinitionToDocument<TState>(
  definition: WorkflowDefinition<TState>
): WorkflowDefinitionDocument {
  const states: WorkflowDefinitionDocument['states'] = {};
  const stepIds = definition.steps.map((step) => step.id);
  const initial = stepIds[0] ?? 'completed';

  for (let i = 0; i < definition.steps.length; i++) {
    const step = definition.steps[i];
    const nextId = definition.steps[i + 1]?.id ?? 'completed';
    const transition =
      'when' in step && step.when
        ? { event: 'always', target: nextId, guard: step.when }
        : { event: 'always', target: nextId };

    let invokeSrc: string;
    if ('command' in step) {
      invokeSrc = step.command;
    } else if ('kind' in step && step.kind === 'loop') {
      invokeSrc = `loop:${step.id}`;
    } else {
      invokeSrc = `execute:${step.id}`;
    }

    states[step.id] = {
      invoke: { src: invokeSrc },
      transitions: [transition],
    };
  }

  states.completed = {
    type: 'final',
    transitions: [],
  };

  return {
    format: 'workflow/v1',
    id: definition.id,
    initial,
    states,
  };
}
