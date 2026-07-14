import { randomUUID } from 'node:crypto';
import { setup, fromPromise, createActor, assign, toPromise, type AnyActorLogic } from 'xstate';
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
  WorkflowLoopStep,
  WorkflowExecuteStep,
} from './workflow-types.js';
import { WorkflowAbortError } from './workflow-types.js';
import type { ToolManager } from '../tooling/manager/tool-manager.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';
import {
  evaluateWorkflowCondition,
  resolveTemplateData,
  resolveTemplateExpressions,
} from './workflow-param-resolver.js';
import { workflowDefinitionJsonToYaml } from './definition-format.js';

export interface IWorkflowLocalCommand {
  execute(params: any, ctx?: any): Promise<unknown>;
}

export interface WorkflowRunOptions {
  signal?: AbortSignal;
  emit?: (event: RuntimeStreamEvent) => void;
  executionContext?: ExecutionContext;
  commands?: Record<string, IWorkflowLocalCommand>;
}

export interface IWorkflowRunner {
  run<TState>(
    definition: WorkflowDefinition<TState>,
    initialState: TState,
    options?: WorkflowRunOptions
  ): Promise<WorkflowResult<TState>>;
}

interface WorkflowMachineContext<TState> {
  state: TState;
  container: IServiceContainer;
  toolManager?: ToolManager;
  options?: WorkflowRunOptions;
  workflowId: string;
  workflowInstanceId: string;
  aborted: boolean;
  loopIterations: Record<string, number>;
}

interface CommandExecutionInput {
  commandToken: string;
  params: unknown;
  ctx: ExecutionContext;
  context: WorkflowMachineContext<any>;
}

export class WorkflowRunner implements IWorkflowRunner {
  constructor(private readonly container: IServiceContainer) {}

  async run<TState>(
    definition: WorkflowDefinition<TState>,
    initialState: TState,
    options?: WorkflowRunOptions
  ): Promise<WorkflowResult<TState>> {
    const workflowInstanceId = `${definition.id}:${randomUUID()}`;

    // Create the machine
    const machine = this.compileMachine(definition);

    // Create and start the actor
    const actor = createActor(machine, {
      input: {
        initialState,
        container: this.container,
        options,
        workflowId: definition.id,
        workflowInstanceId,
      },
    });

    actor.start();

    // Handle abort signal
    if (options?.signal) {
      const abortHandler = () => {
        actor.stop();
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      // Wait for the actor to complete and get the final snapshot
      await toPromise(actor);
      const snapshot = actor.getSnapshot();

      // Access the context from the snapshot
      const context = snapshot.context as WorkflowMachineContext<TState>;

      return {
        state: context.state,
        aborted: context.aborted,
      };
    } catch (error) {
      if (error instanceof WorkflowAbortError) {
        return {
          state: initialState,
          aborted: true,
        };
      }
      throw error;
    }
  }

  private compileMachine<TState>(definition: WorkflowDefinition<TState>) {
    const actors = this.compileActors(definition);
    const guards = this.compileGuards(definition);
    const states = this.compileStates(definition);

    return setup({
      types: {} as {
        context: WorkflowMachineContext<TState>;
        input: {
          initialState: TState;
          container: IServiceContainer;
          options?: WorkflowRunOptions;
          workflowId: string;
          workflowInstanceId: string;
        };
      },
      actors,
      guards,
    }).createMachine({
      id: definition.id,
      context: ({ input }) => ({
        state: input.initialState,
        container: input.container,
        options: input.options,
        workflowId: input.workflowId,
        workflowInstanceId: input.workflowInstanceId,
        aborted: false,
        loopIterations: {},
      }),
      initial: definition.steps[0]?.id ?? 'completed',
      states,
    });
  }

  private compileActors<TState>(
    definition: WorkflowDefinition<TState>
  ): Record<string, AnyActorLogic> {
    const actors: Record<string, AnyActorLogic> = {
      // Generic command executor
      executeCommand: fromPromise(async ({ input }: { input: CommandExecutionInput }) => {
        const { commandToken, params, ctx, context } = input;

        // Resolve command (check overrides first, then ToolManager)
        const cmd =
          context.options?.commands?.[commandToken] ??
          this.getToolManager(context.container).get(commandToken);

        if (!cmd) {
          throw new Error(`WorkflowRunner: command '${commandToken}' not registered`);
        }

        const result = await cmd.execute(params, ctx);
        return result;
      }),
    };

    // Create actors for execute steps (inline functions)
    for (const step of definition.steps) {
      if ('execute' in step && !('command' in step)) {
        const executeStep = step as WorkflowExecuteStep<TState>;
        actors[`execute_${step.id}`] = fromPromise(
          async ({
            input,
          }: {
            input: { state: TState; ctx: ExecutionContext; container: IServiceContainer };
          }) => {
            return await executeStep.execute(input.state, input.ctx, input.container);
          }
        );
      }

      // Handle loop steps recursively
      if ('kind' in step && step.kind === 'loop') {
        const loopStep = step as WorkflowLoopStep<TState>;
        this.addLoopActors(actors, loopStep, definition.id);
      }
    }

    return actors;
  }

  private addLoopActors<TState>(
    actors: Record<string, AnyActorLogic>,
    loopStep: WorkflowLoopStep<TState>,
    workflowId: string
  ): void {
    for (const step of loopStep.steps) {
      if ('execute' in step && !('command' in step)) {
        const executeStep = step as WorkflowExecuteStep<TState>;
        actors[`execute_${loopStep.id}_${step.id}`] = fromPromise(
          async ({
            input,
          }: {
            input: { state: TState; ctx: ExecutionContext; container: IServiceContainer };
          }) => {
            return await executeStep.execute(input.state, input.ctx, input.container);
          }
        );
      }

      // Handle nested loops
      if ('kind' in step && step.kind === 'loop') {
        this.addLoopActors(actors, step as WorkflowLoopStep<TState>, workflowId);
      }
    }
  }

  private compileGuards<TState>(definition: WorkflowDefinition<TState>): Record<string, any> {
    const guards: Record<string, any> = {};

    for (const step of definition.steps) {
      // Guard for 'when' condition
      if ('when' in step && step.when) {
        guards[`when_${step.id}`] = ({ context }: { context: WorkflowMachineContext<TState> }) => {
          return evaluateWorkflowCondition(
            step.when!,
            context.state as Record<string, unknown>,
            undefined
          );
        };
      }

      // Guard for 'skipWhen' condition (inverse logic)
      if ('skipWhen' in step && step.skipWhen) {
        guards[`skipWhen_${step.id}`] = ({
          context,
        }: {
          context: WorkflowMachineContext<TState>;
        }) => {
          // Evaluate string expression - return true if we should NOT skip (inverse logic)
          return !evaluateWorkflowCondition(
            step.skipWhen!,
            context.state as Record<string, unknown>
          );
        };
      }

      // Guards for loop steps
      if ('kind' in step && step.kind === 'loop') {
        const loopStep = step as WorkflowLoopStep<TState>;
        guards[`loop_${step.id}_continue`] = ({
          context,
        }: {
          context: WorkflowMachineContext<TState>;
        }) => {
          const iteration = context.loopIterations[step.id] ?? 0;
          const maxIterations = loopStep.maxIterations ?? 100;

          if (iteration >= maxIterations) {
            return false;
          }

          return evaluateWorkflowCondition(
            loopStep.while,
            context.state as Record<string, unknown>,
            iteration
          );
        };

        // Add guards for loop body steps
        this.addLoopGuards(guards, loopStep, step.id);
      }
    }

    return guards;
  }

  private addLoopGuards<TState>(
    guards: Record<string, any>,
    loopStep: WorkflowLoopStep<TState>,
    loopId: string
  ): void {
    for (const step of loopStep.steps) {
      const stepId = `${loopId}_${step.id}`;

      if ('when' in step && step.when) {
        guards[`when_${stepId}`] = ({ context }: { context: WorkflowMachineContext<TState> }) => {
          const iteration = context.loopIterations[loopId] ?? 0;
          return evaluateWorkflowCondition(
            step.when!,
            context.state as Record<string, unknown>,
            iteration
          );
        };
      }

      if ('skipWhen' in step && step.skipWhen) {
        guards[`skipWhen_${stepId}`] = ({
          context,
        }: {
          context: WorkflowMachineContext<TState>;
        }) => {
          // Evaluate string expression - return true if we should NOT skip (inverse logic)
          return !evaluateWorkflowCondition(
            step.skipWhen!,
            context.state as Record<string, unknown>
          );
        };
      }

      if ('kind' in step && step.kind === 'loop') {
        this.addLoopGuards(guards, step as WorkflowLoopStep<TState>, stepId);
      }
    }
  }

  private compileStates<TState>(definition: WorkflowDefinition<TState>): Record<string, any> {
    const states: Record<string, any> = {};

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      const nextStepId = definition.steps[i + 1]?.id ?? 'completed';

      if ('kind' in step && step.kind === 'loop') {
        states[step.id] = this.compileLoopState(step as WorkflowLoopStep<TState>, nextStepId);
      } else if ('command' in step) {
        states[step.id] = this.compileCommandState(step as WorkflowCommandStep<TState>, nextStepId);
      } else if ('execute' in step) {
        states[step.id] = this.compileExecuteState(step as WorkflowExecuteStep<TState>, nextStepId);
      }
    }

    states.completed = {
      id: 'completed',
      type: 'final',
    };

    states.aborted = {
      id: 'aborted',
      type: 'final',
      entry: assign({
        aborted: true,
      }),
    };

    return states;
  }

  private compileCommandState<TState>(step: WorkflowCommandStep<TState>, nextStepId: string): any {
    const shouldSkip = 'skipWhen' in step && step.skipWhen;
    const hasWhen = 'when' in step && step.when;

    return {
      invoke: {
        src: 'executeCommand',
        input: ({ context }: { context: WorkflowMachineContext<TState> }) => ({
          commandToken: step.command,
          params: this.resolveParams(step, context.state),
          ctx: this.createExecutionContext(context, step.id),
          context,
        }),
        onDone: {
          target: nextStepId,
          guard: this.buildTransitionGuard(step),
          actions: assign(({ context, event }: any) => {
            const newState = this.applyStepResult(step, context.state, event.output);
            return { ...context, state: newState };
          }),
        },
        onError: {
          target: '#aborted',
          actions: assign({
            aborted: true,
          }),
        },
      },
      always:
        shouldSkip || hasWhen
          ? [
              {
                target: nextStepId,
                guard: shouldSkip ? { type: `skipWhen_${step.id}`, params: {} } : undefined,
              },
            ]
          : undefined,
    };
  }

  private compileExecuteState<TState>(step: WorkflowExecuteStep<TState>, nextStepId: string): any {
    return {
      invoke: {
        src: `execute_${step.id}`,
        input: ({ context }: { context: WorkflowMachineContext<TState> }) => ({
          state: context.state,
          ctx: this.createExecutionContext(context, step.id),
          container: context.container,
        }),
        onDone: {
          target: nextStepId,
          guard: this.buildTransitionGuard(step),
          actions: assign(({ event }: any) => ({
            state: event.output,
          })),
        },
        onError: {
          target: '#aborted',
        },
      },
    };
  }

  private compileLoopState<TState>(loopStep: WorkflowLoopStep<TState>, nextStepId: string): any {
    const loopBodyStates: Record<string, any> = {};
    const firstBodyStepId = loopStep.steps[0]?.id;

    // Compile loop body steps
    for (let i = 0; i < loopStep.steps.length; i++) {
      const step = loopStep.steps[i];
      const nextBodyStepId = loopStep.steps[i + 1]?.id ?? 'loopCheck';

      if ('command' in step) {
        loopBodyStates[step.id] = this.compileLoopCommandState(
          step as WorkflowCommandStep<TState>,
          nextBodyStepId,
          loopStep.id
        );
      } else if ('execute' in step) {
        loopBodyStates[step.id] = this.compileLoopExecuteState(
          step as WorkflowExecuteStep<TState>,
          nextBodyStepId,
          loopStep.id
        );
      } else if ('kind' in step && step.kind === 'loop') {
        // Nested loop - recursively compile
        loopBodyStates[step.id] = this.compileLoopState(
          step as WorkflowLoopStep<TState>,
          nextBodyStepId
        );
      }
    }

    // Loop check state - decides whether to continue or exit
    loopBodyStates.loopCheck = {
      always: [
        {
          target: firstBodyStepId,
          guard: { type: `loop_${loopStep.id}_continue` },
          actions: assign(({ context }: any) => ({
            loopIterations: {
              ...context.loopIterations,
              [loopStep.id]: (context.loopIterations[loopStep.id] ?? 0) + 1,
            },
          })),
        },
        {
          target: `#${nextStepId}`,
        },
      ],
    };

    return {
      initial: 'init',
      states: {
        init: {
          always: {
            target: firstBodyStepId,
            actions: assign(({ context }: any) => ({
              loopIterations: {
                ...context.loopIterations,
                [loopStep.id]: 0,
              },
            })),
          },
        },
        ...loopBodyStates,
      },
    };
  }

  private compileLoopCommandState<TState>(
    step: WorkflowCommandStep<TState>,
    nextStepId: string,
    loopId: string
  ): any {
    return {
      invoke: {
        src: 'executeCommand',
        input: ({ context }: { context: WorkflowMachineContext<TState> }) => ({
          commandToken: step.command,
          params: this.resolveParams(step, context.state, context.loopIterations[loopId]),
          ctx: this.createExecutionContext(context, `${loopId}_${step.id}`),
          context,
        }),
        onDone: {
          target: nextStepId,
          actions: assign(({ context, event }: any) => {
            const newState = this.applyStepResult(step, context.state, event.output);
            return { ...context, state: newState };
          }),
        },
        onError: '#aborted',
      },
    };
  }

  private compileLoopExecuteState<TState>(
    step: WorkflowExecuteStep<TState>,
    nextStepId: string,
    loopId: string
  ): any {
    return {
      invoke: {
        src: `execute_${loopId}_${step.id}`,
        input: ({ context }: { context: WorkflowMachineContext<TState> }) => ({
          state: context.state,
          ctx: this.createExecutionContext(context, `${loopId}_${step.id}`),
          container: context.container,
        }),
        onDone: {
          target: nextStepId,
          actions: assign(({ event }: any) => ({
            state: event.output,
          })),
        },
        onError: '#aborted',
      },
    };
  }

  private buildTransitionGuard<TState>(step: WorkflowStep<TState>): any {
    const hasWhen = 'when' in step && step.when;
    const hasSkipWhen = 'skipWhen' in step && step.skipWhen;

    if (!hasWhen && !hasSkipWhen) {
      return undefined;
    }

    const guards = [];
    if (hasWhen) {
      guards.push({ type: `when_${step.id}` });
    }
    if (hasSkipWhen) {
      guards.push({ type: `skipWhen_${step.id}` });
    }

    return guards.length === 1 ? guards[0] : { type: 'and', guards };
  }

  private resolveParams<TState>(
    step: WorkflowCommandStep<TState>,
    state: TState,
    index?: number
  ): unknown {
    if (step.params) {
      return step.params(state);
    }
    if (step.args) {
      return resolveTemplateExpressions(step.args, state as Record<string, unknown>, index);
    }
    return {};
  }

  private applyStepResult<TState>(
    step: WorkflowCommandStep<TState>,
    state: TState,
    result: unknown
  ): TState {
    if (step.applyResult) {
      return step.applyResult(state, result);
    }

    // Auto-store result at state[stepId]
    const newState = { ...(state as Record<string, unknown>) };
    const existing = newState[step.id];
    newState[step.id] = Array.isArray(existing) ? [...existing, result] : result;
    return newState as TState;
  }

  private createExecutionContext<TState>(
    context: WorkflowMachineContext<TState>,
    stepId: string
  ): ExecutionContext {
    return {
      ...(context.options?.executionContext ?? { history: [] }),
      ...(context.options?.signal !== undefined ? { signal: context.options.signal } : {}),
      workflowId: context.workflowId,
      workflowInstanceId: context.workflowInstanceId,
      stepId,
    };
  }

  private getToolManager(container: IServiceContainer): ToolManager {
    return container.resolve<ToolManager>(COMMAND_FACTORY_TOKENS.ToolManager);
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────────────

export interface IWorkflowRunnerFactory {
  create(): IWorkflowRunner;
  asCommand<TState>(definition: WorkflowDefinition<TState>): ICommand;
}

export function workflowDescriptor<TState>(
  definition: WorkflowDefinition<TState>
): ICommandDescriptor {
  const aliases = new Set<string>(definition.aliases ?? []);
  aliases.add(definition.id);
  aliases.add(`workflow_${definition.id}`);

  const tags = new Set<string>(definition.tags ?? []);
  tags.add('workflow-definition');

  const { id, aliases: _aliases, tags: _tags, ...descriptorFields } = definition;

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

  asCommand<TState>(definition: WorkflowDefinition<TState>): ICommand {
    const {
      id,
      steps: _steps,
      prepare: _prepare,
      toResult: _toResult,
      result: _result,
      ...descriptorFields
    } = definition;

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
