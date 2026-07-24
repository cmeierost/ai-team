import { randomUUID } from 'node:crypto';
import { setup, fromPromise, createActor, assign, toPromise, type AnyActorLogic, type InspectionEvent } from 'xstate';
import type {
  RuntimeStreamEvent,
  WorkflowDefinitionApiResponse,
  WorkflowDefinitionDocument,
} from '@ai-team/api-contracts';
import {
  type ExecutionContext,
  type IBackendLogService,
  type ICommand,
  type ICommandDescriptor,
  type CommandResponse,
  type IServiceContainer,
  type IToolManager,
  CORE_SERVICE_TOKENS,
} from '@ai-team/core';
import type {
  WorkflowCommandStep,
  WorkflowDefinition,
  WorkflowResult,
  WorkflowStep,
  WorkflowLoopStep,
  WorkflowExecuteStep,
  WorkflowReturnDefinition,
} from './workflow-types.js';
import { WorkflowAbortError } from './workflow-types.js';
import type { ToolManager } from '../tooling/manager/tool-manager.js';
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
  backendLogService?: IBackendLogService;
  toolManager?: ToolManager;
  options?: WorkflowRunOptions;
  workflowId: string;
  workflowInstanceId: string;
  aborted: boolean;
  abortedError: string | undefined;
  loopIterations: Record<string, number>;
  workflowReturn?: WorkflowReturnDefinition;
  workflowLastResult?: ExecutionContext['workflowLastResult'];
}

interface CommandExecutionInput {
  commandToken: string;
  params: unknown;
  ctx: ExecutionContext;
  context: WorkflowMachineContext<any>;
}

export class WorkflowRunner implements IWorkflowRunner {
  constructor(
    private readonly container: IServiceContainer,
    private readonly backendLogService: IBackendLogService
  ) {}

  async run<TState>(
    definition: WorkflowDefinition<TState>,
    initialState: TState,
    options?: WorkflowRunOptions
  ): Promise<WorkflowResult<TState>> {
    const workflowInstanceId = `${definition.id}:${randomUUID()}`;

    this.logWorkflowRunDebug({
      phase: 'run-start',
      workflowId: definition.id,
      workflowInstanceId,
      initialStepId: definition.steps[0]?.id ?? 'completed',
      stepCount: definition.steps.length,
    });

    // Create the machine
    const machine = this.compileMachine(definition);

    // Create XState inspector — only log events the state subscription doesn't already cover.
    // The subscription handles state transitions; the inspector adds invoke lifecycle (actor
    // spawn/stop) and action execution, which are useful for debugging timing and side effects.
    const inspect: (event: InspectionEvent) => void = (event) => {
      if (event.type === '@xstate.actor') {
        this.logWorkflowRunDebug({
          phase: 'xstate-actor',
          workflowId: definition.id,
          workflowInstanceId,
          actorRef: (event as any).actorRef?.id ?? 'root',
        });
      }
    };

    // Create and start the actor
    const actor = createActor(machine, {
      input: {
        initialState,
        container: this.container,
        options,
        workflowId: definition.id,
        workflowInstanceId,
      },
      inspect,
    });

    let previousStateValue = '';
    const subscription = actor.subscribe((snapshot) => {
      const currentStateValue = this.serializeStateValue(snapshot.value);
      if (currentStateValue === previousStateValue) {
        return;
      }

      const context = snapshot.context as WorkflowMachineContext<TState>;
      this.logWorkflowDebug(context, {
        phase: 'state-transition',
        ...(previousStateValue ? { fromState: previousStateValue } : {}),
        toState: currentStateValue,
        status: snapshot.status,
        loopIterations: { ...context.loopIterations },
      });
      previousStateValue = currentStateValue;
    });

    actor.start();

    // Handle abort signal
    let abortHandler: (() => void) | undefined;
    let abortRequested = false;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      if (!options?.signal) {
        return;
      }

      abortHandler = () => {
        abortRequested = true;

        // Capture current snapshot BEFORE stopping the actor
        try {
          const snapshot = actor.getSnapshot();
          const ctx = snapshot.context as WorkflowMachineContext<TState>;
          this.logWorkflowRunDebug({
            phase: 'run-abort-requested',
            workflowId: definition.id,
            workflowInstanceId,
            currentState: this.serializeStateValue(snapshot.value),
            status: snapshot.status,
            loopIterations: { ...ctx.loopIterations },
            aborted: ctx.aborted,
            abortedError: ctx.abortedError,
          });
        } catch (e) {
          this.logWorkflowRunDebug({
            phase: 'run-abort-requested',
            workflowId: definition.id,
            workflowInstanceId,
            snapshotError: this.toErrorMessage(e),
          });
        }

        actor.stop();
        reject(new WorkflowAbortError(options.signal?.reason));
      };

      if (options.signal.aborted) {
        abortHandler();
        return;
      }

      options.signal.addEventListener('abort', abortHandler, { once: true });
    });

    try {
      // Wait for the actor to complete and get the final snapshot
      await Promise.race([toPromise(actor), abortPromise]);
      if (abortRequested || options?.signal?.aborted) {
        throw new WorkflowAbortError(options?.signal?.reason);
      }
      const snapshot = actor.getSnapshot();

      // Access the context from the snapshot
      const context = snapshot.context as WorkflowMachineContext<TState>;

      this.logWorkflowDebug(context, {
        phase: 'run-complete',
        aborted: context.aborted,
        finalState: this.serializeStateValue(snapshot.value),
      });

      return {
        state: context.state,
        aborted: context.aborted,
      };
    } catch (error) {
      if (error instanceof WorkflowAbortError) {
        // Try to get the last known state from the actor before it was stopped
        let lastState = initialState;
        try {
          const snapshot = actor.getSnapshot();
          const ctx = snapshot.context as WorkflowMachineContext<TState>;
          lastState = ctx.state ?? initialState;
        } catch {
          // Actor already stopped or never started, fall back to initial state
        }

        this.logWorkflowRunDebug({
          phase: 'run-aborted',
          workflowId: definition.id,
          workflowInstanceId,
          recoveredStateAvailable: lastState !== initialState,
          abortedError: error.reasonMessage,
        });
        return {
          state: lastState,
          aborted: true,
          abortedError: error.reasonMessage,
        };
      }

      // Check if the machine transitioned to #aborted (step-level onError).
      // Log the captured error so it's visible on the console.
      const snapshot = actor.getSnapshot();
      const ctx = snapshot.context as WorkflowMachineContext<TState>;
      if (ctx.aborted && ctx.abortedError) {
        this.logWorkflowAbortError(ctx, ctx.abortedError);
        return {
          state: ctx.state,
          aborted: true,
          abortedError: ctx.abortedError,
        };
      }

      this.logWorkflowRunDebug({
        phase: 'run-error',
        workflowId: definition.id,
        workflowInstanceId,
        error: this.toErrorMessage(error),
      });
      throw error;
    } finally {
      subscription.unsubscribe();
      if (abortHandler && options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
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
        backendLogService: this.backendLogService,
        options: input.options,
        workflowId: input.workflowId,
        workflowInstanceId: input.workflowInstanceId,
        aborted: false,
        abortedError: undefined,
        loopIterations: {},
        workflowReturn: definition.return,
        workflowLastResult: undefined,
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

        this.logWorkflowDebug(context, {
          phase: 'command-start',
          stepId: ctx.stepId,
          commandToken,
        });
        const startedAt = Date.now();

        // Resolve command (check overrides first, then ToolManager)
        const cmd =
          context.options?.commands?.[commandToken] ??
          this.getToolManager(context.container).get(commandToken);

        if (!cmd) {
          this.logWorkflowDebug(context, {
            phase: 'command-missing',
            stepId: ctx.stepId,
            commandToken,
          });
          throw new Error(`WorkflowRunner: command '${commandToken}' not registered`);
        }

        try {
          const result = await cmd.execute(params, ctx);
          this.logWorkflowDebug(context, {
            phase: 'command-complete',
            stepId: ctx.stepId,
            commandToken,
            elapsedMs: Date.now() - startedAt,
          });
          return result;
        } catch (error) {
          this.logWorkflowDebug(context, {
            phase: 'command-error',
            stepId: ctx.stepId,
            commandToken,
            elapsedMs: Date.now() - startedAt,
            error: this.toErrorMessage(error),
          });
          throw error;
        }
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
            this.logExecutionContextDebug(input.ctx, {
              phase: 'execute-start',
            });
            const startedAt = Date.now();
            try {
              const result = await executeStep.execute(input.state, input.ctx, input.container);
              this.logExecutionContextDebug(input.ctx, {
                phase: 'execute-complete',
                elapsedMs: Date.now() - startedAt,
              });
              return result;
            } catch (error) {
              this.logExecutionContextDebug(input.ctx, {
                phase: 'execute-error',
                elapsedMs: Date.now() - startedAt,
                error: this.toErrorMessage(error),
              });
              throw error;
            }
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
            this.logExecutionContextDebug(input.ctx, {
              phase: 'execute-start',
            });
            const startedAt = Date.now();
            try {
              const result = await executeStep.execute(input.state, input.ctx, input.container);
              this.logExecutionContextDebug(input.ctx, {
                phase: 'execute-complete',
                elapsedMs: Date.now() - startedAt,
              });
              return result;
            } catch (error) {
              this.logExecutionContextDebug(input.ctx, {
                phase: 'execute-error',
                elapsedMs: Date.now() - startedAt,
                error: this.toErrorMessage(error),
              });
              throw error;
            }
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
      this.registerStepSkipGuard(guards, step, step.id);

      // Guards for loop steps
      if ('kind' in step && step.kind === 'loop') {
        const loopStep = step as WorkflowLoopStep<TState>;
        guards[`loop_${step.id}_continue`] = this.createLoopContinueGuard(loopStep, step.id);

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
      this.registerStepSkipGuard(guards, step, stepId, loopId);

      if ('kind' in step && step.kind === 'loop') {
        const nestedLoopStep = step as WorkflowLoopStep<TState>;
        guards[`loop_${nestedLoopStep.id}_continue`] = this.createLoopContinueGuard(
          nestedLoopStep,
          nestedLoopStep.id
        );
        this.addLoopGuards(guards, nestedLoopStep, nestedLoopStep.id);
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
    const hasConditions = this.hasStepConditions(step);

    return {
      always: hasConditions
        ? [
            {
              target: nextStepId,
              guard: { type: this.getStepSkipGuardType(step.id) },
            },
          ]
        : undefined,
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
          actions: assign(({ context, event }: any) => {
            const newState = this.applyStepResult(step, context.state, event.output);
            return {
              ...context,
              state: newState,
              workflowLastResult: event.output,
            };
          }),
        },
        onError: {
          target: '#aborted',
          actions: assign({
            aborted: true,
            abortedError: ({ event }: any) => this.toErrorMessage(event.error),
          }),
        },
      },
    };
  }

  private compileExecuteState<TState>(step: WorkflowExecuteStep<TState>, nextStepId: string): any {
    const hasConditions = this.hasStepConditions(step);

    return {
      always: hasConditions
        ? [
            {
              target: nextStepId,
              guard: { type: this.getStepSkipGuardType(step.id) },
            },
          ]
        : undefined,
      invoke: {
        src: `execute_${step.id}`,
        input: ({ context }: { context: WorkflowMachineContext<TState> }) => ({
          state: context.state,
          ctx: this.createExecutionContext(context, step.id),
          container: context.container,
        }),
        onDone: {
          target: nextStepId,
          actions: assign(({ event }: any) => ({
            state: event.output,
          })),
        },
        onError: {
          target: '#aborted',
          actions: assign({
            aborted: true,
            abortedError: ({ event }: any) => this.toErrorMessage(event.error),
          }),
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
    const stepId = `${loopId}_${step.id}`;
    const hasConditions = this.hasStepConditions(step);

    return {
      always: hasConditions
        ? [
            {
              target: nextStepId,
              guard: { type: this.getStepSkipGuardType(stepId) },
            },
          ]
        : undefined,
      invoke: {
        src: 'executeCommand',
        input: ({ context }: { context: WorkflowMachineContext<TState> }) => ({
          commandToken: step.command,
          params: this.resolveParams(step, context.state, context.loopIterations[loopId]),
          ctx: this.createExecutionContext(context, stepId),
          context,
        }),
        onDone: {
          target: nextStepId,
          actions: assign(({ context, event }: any) => {
            const newState = this.applyStepResult(step, context.state, event.output);
            return {
              ...context,
              state: newState,
              workflowLastResult: event.output,
            };
          }),
        },
        onError: {
          target: '#aborted',
          actions: assign({
            aborted: true,
            abortedError: ({ event }: any) => this.toErrorMessage(event.error),
          }),
        },
      },
    };
  }

  private compileLoopExecuteState<TState>(
    step: WorkflowExecuteStep<TState>,
    nextStepId: string,
    loopId: string
  ): any {
    const stepId = `${loopId}_${step.id}`;
    const hasConditions = this.hasStepConditions(step);

    return {
      always: hasConditions
        ? [
            {
              target: nextStepId,
              guard: { type: this.getStepSkipGuardType(stepId) },
            },
          ]
        : undefined,
      invoke: {
        src: `execute_${loopId}_${step.id}`,
        input: ({ context }: { context: WorkflowMachineContext<TState> }) => ({
          state: context.state,
          ctx: this.createExecutionContext(context, stepId),
          container: context.container,
        }),
        onDone: {
          target: nextStepId,
          actions: assign(({ event }: any) => ({
            state: event.output,
          })),
        },
        onError: {
          target: '#aborted',
          actions: assign({
            aborted: true,
            abortedError: ({ event }: any) => this.toErrorMessage(event.error),
          }),
        },
      },
    };
  }

  private hasStepConditions<TState>(step: WorkflowStep<TState>): boolean {
    return Boolean(('when' in step && step.when) || ('skipWhen' in step && step.skipWhen));
  }

  private getStepSkipGuardType(stepId: string): string {
    return `shouldSkip_${stepId}`;
  }

  private registerStepSkipGuard<TState>(
    guards: Record<string, any>,
    step: WorkflowStep<TState>,
    stepId: string,
    loopId?: string
  ): void {
    if (!this.hasStepConditions(step)) {
      return;
    }

    guards[this.getStepSkipGuardType(stepId)] = ({
      context,
    }: {
      context: WorkflowMachineContext<TState>;
    }) => {
      const iteration = loopId ? (context.loopIterations[loopId] ?? 0) : undefined;
      const whenCondition = 'when' in step ? step.when : undefined;
      const skipWhenCondition = 'skipWhen' in step ? step.skipWhen : undefined;

      const whenSatisfied = whenCondition
        ? evaluateWorkflowCondition(
            whenCondition,
            context.state as Record<string, unknown>,
            iteration
          )
        : true;

      const skipRequested = skipWhenCondition
        ? evaluateWorkflowCondition(
            skipWhenCondition,
            context.state as Record<string, unknown>,
            iteration
          )
        : false;

      const shouldSkip = !whenSatisfied || skipRequested;
      if (shouldSkip) {
        this.logWorkflowDebug(context, {
          phase: 'step-skipped',
          stepId,
          iteration,
          ...(whenCondition ? { whenCondition } : {}),
          ...(skipWhenCondition ? { skipWhenCondition } : {}),
        });
      }
      return shouldSkip;
    };
  }

  private createLoopContinueGuard<TState>(
    loopStep: WorkflowLoopStep<TState>,
    loopId: string
  ): ({ context }: { context: WorkflowMachineContext<TState> }) => boolean {
    return ({ context }: { context: WorkflowMachineContext<TState> }) => {
      const iteration = context.loopIterations[loopId] ?? 0;
      const maxIterations = loopStep.maxIterations ?? 100;

      if (iteration >= maxIterations) {
        this.logWorkflowDebug(context, {
          phase: 'loop-check',
          stepId: loopId,
          iteration,
          maxIterations,
          shouldContinue: false,
          reason: 'max-iterations-reached',
        });
        return false;
      }

      const shouldContinue = evaluateWorkflowCondition(
        loopStep.while,
        context.state as Record<string, unknown>,
        iteration
      );

      this.logWorkflowDebug(context, {
        phase: 'loop-check',
        stepId: loopId,
        iteration,
        maxIterations,
        shouldContinue,
      });

      return shouldContinue;
    };
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
    const base = context.options?.executionContext ?? { history: [] };
    const parentFrame = base.workflowId
      ? {
          workflowId: base.workflowId,
          ...(base.workflowInstanceId
            ? { workflowInstanceId: base.workflowInstanceId }
            : {}),
          ...(base.agentId ? { agentId: base.agentId } : {}),
          ...(base.sessionId ? { sessionId: base.sessionId } : {}),
        }
      : undefined;
    const workflowStack = [
      ...(base.workflowStack ?? []),
      ...(parentFrame ? [parentFrame] : []),
    ];
    const workflowReturn = context.workflowReturn
      ? {
          command: context.workflowReturn.command,
          ...(context.workflowReturn.args
            ? {
                args: resolveTemplateData(
                  context.workflowReturn.args,
                  context.state as Record<string, unknown>
                ) as NonNullable<ExecutionContext['workflowReturn']>['args'],
              }
            : {}),
        }
      : undefined;

    return {
      ...base,
      ...(context.options?.signal !== undefined ? { signal: context.options.signal } : {}),
      workflowId: context.workflowId,
      workflowInstanceId: context.workflowInstanceId,
      stepId,
      ...(workflowReturn ? { workflowReturn } : {}),
      ...(context.workflowLastResult !== undefined
        ? { workflowLastResult: context.workflowLastResult }
        : {}),
      ...(workflowStack.length > 0 ? { workflowStack } : {}),
    };
  }

  private getToolManager(container: IServiceContainer): IToolManager {
    return container.resolve(CORE_SERVICE_TOKENS.ToolManager);
  }

  private logWorkflowAbortError<TState>(
    context: WorkflowMachineContext<TState>,
    errorMessage: string
  ): void {
    const backendLogService =
      context.backendLogService ?? this.backendLogService;
    if (!backendLogService) {
      return;
    }

    backendLogService.write({
      source: 'workflow-runner',
      level: 'error',
      phase: 'workflow-aborted',
      workflowId: context.workflowId,
      workflowInstanceId: context.workflowInstanceId,
      error: errorMessage,
    });
  }

  private logWorkflowRunDebug(entry: Record<string, unknown>): void {
    this.backendLogService.write({
      source: 'workflow-runner',
      level: 'debug',
      ...entry,
    });
  }

  private logWorkflowDebug<TState>(
    context: WorkflowMachineContext<TState>,
    entry: Record<string, unknown>
  ): void {
    const backendLogService =
      context.backendLogService ?? this.backendLogService;
    if (!backendLogService) {
      return;
    }

    backendLogService.write({
      source: 'workflow-runner',
      level: 'debug',
      workflowId: context.workflowId,
      workflowInstanceId: context.workflowInstanceId,
      ...entry,
    });
  }

  private logExecutionContextDebug(
    executionContext: ExecutionContext,
    entry: Record<string, unknown>
  ): void {
    this.backendLogService.write({
      source: 'workflow-runner',
      level: 'debug',
      workflowId: executionContext.workflowId,
      workflowInstanceId: executionContext.workflowInstanceId,
      stepId: executionContext.stepId,
      ...entry,
    });
  }

  private serializeStateValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
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

  const {
    id,
    aliases: _aliases,
    tags: _tags,
    return: _return,
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
    const backendLogService = this.container.resolve(CORE_SERVICE_TOKENS.BackendLogService) as IBackendLogService;
    return new WorkflowRunner(this.container, backendLogService);
  }

  asCommand<TState>(definition: WorkflowDefinition<TState>): ICommand {
    const {
      id,
      steps: _steps,
      prepare: _prepare,
      toResult: _toResult,
      result: _result,
      return: _return,
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
    if (runResult.aborted) {
      const detail = runResult.abortedError ? `: ${runResult.abortedError}` : '';
      return { status: 'error', message: `Workflow aborted${detail}` };
    }

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
    ...(definition.return
      ? {
          return: {
            command: definition.return.command,
            ...(definition.return.args
              ? { args: definition.return.args as Record<string, unknown> }
              : {}),
          },
        }
      : {}),
    states,
  };
}
