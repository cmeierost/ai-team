import { randomUUID } from 'node:crypto';
import { setup, fromPromise, assign, sendTo, type AnyActorLogic, type InspectionEvent } from 'xstate';
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
  type IWorkflowRunRepository,
  type WorkflowRunRecord,
  type IEmitService,
  CORE_SERVICE_TOKENS,
} from '@ai-team/core';
import type {
  WorkflowCommandStep,
  WorkflowDefinition,
  WorkflowResult,
  WorkflowStep,
  WorkflowLoopStep,
  WorkflowExecuteStep,
  WorkflowChatStep,
  WorkflowQuestionStep,
  WorkflowReturnDefinition,
} from './workflow-types.js';
import { WorkflowAbortError } from './workflow-types.js';
import {
  evaluateWorkflowCondition,
  resolveTemplateData,
  resolveTemplateExpressions,
} from './workflow-param-resolver.js';
import { workflowDefinitionJsonToYaml } from './definition-format.js';
import { WorkflowActorHost } from './workflow-actor-host.js';
import { isWorkflowCommand, workflowCommand, type IWorkflowCommand } from './workflow-command.js';
import { CommandActorAdapterResolver } from './command-actor-adapter-resolver.js';
import { WORKFLOW_SERVICE_TOKENS } from './workflow-service-tokens.js';
import {
  createWorkflowChatActor,
  type WorkflowChatActorInput,
} from './workflow-chat-compiler.js';
import type { WorkflowOperationJournal } from './workflow-operation-journal.js';

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
  start<TState>(
    definition: WorkflowDefinition<TState>,
    initialState: TState,
    options?: WorkflowRunOptions
  ): Promise<WorkflowRunHandle<TState>>;

  run<TState>(
    definition: WorkflowDefinition<TState>,
    initialState: TState,
    options?: WorkflowRunOptions
  ): Promise<WorkflowResult<TState>>;
}

export interface WorkflowRunHandle<TState> {
  readonly id: string;
  getStatus(): 'active' | 'completed' | 'cancelled' | 'failed';
  getSnapshotView(): {
    state: TState;
    aborted: boolean;
    stepId?: string;
    interaction?: WorkflowMachineContext<TState>['activeInteraction'];
  };
  getPersistedSnapshot(): unknown;
  dispatch(event: unknown): Promise<void>;
  checkpoint(): Promise<unknown>;
  cancel(): Promise<void>;
  waitForDone(): Promise<WorkflowResult<TState>>;
}

class EphemeralWorkflowRunRepository implements IWorkflowRunRepository {
  private readonly records = new Map<string, WorkflowRunRecord>();

  async save(record: WorkflowRunRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }

  async get(runId: string): Promise<WorkflowRunRecord | null> {
    return this.records.get(runId) ?? null;
  }

  async findActiveBySession(sessionId: string): Promise<WorkflowRunRecord | null> {
    return (
      [...this.records.values()].find(
        (record) => record.status === 'active' && record.activeSessionId === sessionId
      ) ?? null
    );
  }
}

interface WorkflowMachineContext<TState> {
  state: TState;
  workflowId: string;
  workflowInstanceId: string;
  aborted: boolean;
  abortedError: string | undefined;
  abortedStepId: string | undefined;
  loopIterations: Record<string, number>;
  workflowReturn?: WorkflowReturnDefinition;
  workflowLastResult?: ExecutionContext['workflowLastResult'];
  activeInteraction?: {
    sessionId: string;
    actorPath: string;
    metadata?: {
      kind: 'chat' | 'question';
      prompt?: string;
      response?: { type: 'text' | 'select'; options?: Array<{ value: string; label: string }> };
    };
  };
}

interface CommandExecutionInput {
  commandToken: string;
  params: unknown;
  ctx: ExecutionContext;
  context: WorkflowMachineContext<any>;
}

export class WorkflowRunner implements IWorkflowRunner {
  private readonly actorHost: WorkflowActorHost;
  private readonly commandActorAdapters: CommandActorAdapterResolver;

  constructor(
    private readonly container: IServiceContainer,
    private readonly backendLogService: IBackendLogService,
    actorHost?: WorkflowActorHost,
    commandActorAdapters?: CommandActorAdapterResolver,
    private readonly operationJournal?: WorkflowOperationJournal
  ) {
    this.actorHost = actorHost ?? new WorkflowActorHost(new EphemeralWorkflowRunRepository());
    this.commandActorAdapters = commandActorAdapters ?? new CommandActorAdapterResolver();
  }

  async start<TState>(
    definition: WorkflowDefinition<TState>,
    initialState: TState,
    options?: WorkflowRunOptions
  ): Promise<WorkflowRunHandle<TState>> {
    const workflowInstanceId = `${definition.id}:${randomUUID()}`;
    const emitRuntimeEvent = this.resolveRuntimeEventEmitter(options);
    let terminalWorkflowEventEmitted = false;

    this.logWorkflowRunDebug({
      phase: 'run-start',
      workflowId: definition.id,
      workflowInstanceId,
      initialStepId: definition.steps[0]?.id ?? 'completed',
      stepCount: definition.steps.length,
    });

    // Create the machine
    const machine = this.compileMachine(definition, {
      container: this.container,
      options,
    });

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
        emitRuntimeEvent?.({
          kind: 'workflow_actor',
          workflowId: definition.id,
          workflowInstanceId,
          actorEvent: 'spawned',
          actorRef: (event as any).actorRef?.id ?? 'root',
        } as RuntimeStreamEvent);
      }
    };

    let previousStateValue = '';
    const onSnapshot = (rawSnapshot: unknown) => {
      const snapshot = rawSnapshot as {
        value: unknown;
        status: string;
        context: WorkflowMachineContext<TState>;
      };
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
      const deepest = this.resolveDeepestActiveInteraction(snapshot);
      emitRuntimeEvent?.({
        kind: 'workflow_state',
        workflowId: definition.id,
        workflowInstanceId,
        stateValue: currentStateValue,
        actorStatus: snapshot.status,
        ...(context.abortedStepId ? { stepId: context.abortedStepId } : {}),
        ...(deepest
          ? {
              interaction: {
                sessionId: deepest.sessionId,
                actorPath: deepest.actorPath,
                ...(deepest.metadata ? { metadata: deepest.metadata } : {}),
              },
            }
          : context.activeInteraction
            ? { interaction: context.activeInteraction }
            : {}),
      } as RuntimeStreamEvent);
      previousStateValue = currentStateValue;
    };

    const actorHandle = await this.actorHost.start<
      { initialState: TState; workflowId: string; workflowInstanceId: string },
      unknown
    >({
      runId: workflowInstanceId,
      definitionId: definition.id,
      definitionVersion: definition.version ?? '1',
      actorLogic: machine,
      input: {
        initialState,
        workflowId: definition.id,
        workflowInstanceId,
      },
      rootSessionId: options?.executionContext?.sessionId,
      activeSessionId: options?.executionContext?.sessionId,
      resolveAssociation: (snapshot) => {
        const deepest = this.resolveDeepestActiveInteraction(snapshot);
        if (deepest) {
          return {
            activeSessionId: deepest.sessionId,
            activeActorPath: deepest.actorPath,
          };
        }
        const context = (snapshot as { context?: WorkflowMachineContext<TState> }).context;
        return {
          activeSessionId: context?.activeInteraction?.sessionId ?? options?.executionContext?.sessionId,
          activeActorPath: context?.activeInteraction?.actorPath,
        };
      },
      inspect,
      onSnapshot,
    });
    emitRuntimeEvent?.({
      kind: 'workflow_started',
      workflowId: definition.id,
      workflowInstanceId,
      definitionVersion: definition.version ?? '1',
    } as RuntimeStreamEvent);

    const signalWasAlreadyAborted = options?.signal?.aborted === true;

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
          const snapshot = actorHandle.getSnapshot() as {
            value: unknown;
            status: string;
            context: WorkflowMachineContext<TState>;
          };
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

        void actorHandle.cancel();
        reject(new WorkflowAbortError(options.signal?.reason));
      };

      if (options.signal.aborted) {
        abortHandler();
        return;
      }

      options.signal.addEventListener('abort', abortHandler, { once: true });
    });

    const waitForDone = async (): Promise<WorkflowResult<TState>> => {
      try {
      // Wait for the actor to complete and get the final snapshot
      await Promise.race([actorHandle.waitForDone(), abortPromise]);
      if (abortRequested || options?.signal?.aborted) {
        throw new WorkflowAbortError(options?.signal?.reason);
      }
      const snapshot = actorHandle.getSnapshot() as {
        value: unknown;
        status: string;
        context: WorkflowMachineContext<TState>;
      };

      // Access the context from the snapshot
      const context = snapshot.context as WorkflowMachineContext<TState>;

      this.logWorkflowDebug(context, {
        phase: 'run-complete',
        aborted: context.aborted,
        finalState: this.serializeStateValue(snapshot.value),
      });

      if (context.aborted) {
        const abortDetail = this.describeStepFailure(
          definition.id,
          workflowInstanceId,
          context.abortedStepId,
          context.abortedError
        );
        this.logWorkflowRunError({
          phase: 'workflow-aborted',
          workflowId: definition.id,
          workflowInstanceId,
          ...(context.abortedStepId ? { stepId: context.abortedStepId } : {}),
          error: abortDetail,
        });
        if (!terminalWorkflowEventEmitted) {
          emitRuntimeEvent?.({
            kind: 'workflow_failed',
            workflowId: definition.id,
            workflowInstanceId,
            ...(context.abortedStepId ? { stepId: context.abortedStepId } : {}),
            message: abortDetail,
          } as RuntimeStreamEvent);
          terminalWorkflowEventEmitted = true;
        }
        return {
          state: context.state,
          aborted: true,
          abortedError: abortDetail,
          workflowId: definition.id,
          workflowInstanceId,
          stepId: context.abortedStepId,
        };
      }
      if (!terminalWorkflowEventEmitted) {
        emitRuntimeEvent?.({
          kind: 'workflow_completed',
          workflowId: definition.id,
          workflowInstanceId,
          finalState: this.serializeStateValue(snapshot.value),
        } as RuntimeStreamEvent);
        terminalWorkflowEventEmitted = true;
      }

      return {
        state: context.state,
        aborted: context.aborted,
      };
      } catch (error) {
      if (error instanceof WorkflowAbortError) {
        // Try to get the last known state from the actor before it was stopped
        let lastState = initialState;
        try {
          const snapshot = actorHandle.getSnapshot() as {
            value: unknown;
            status: string;
            context: WorkflowMachineContext<TState>;
          };
          const ctx = snapshot.context as WorkflowMachineContext<TState>;
          lastState = ctx.state ?? initialState;
        } catch {
          // Actor already stopped or never started, fall back to initial state
        }

        const abortDetail = this.describeWorkflowAbort(
          definition.id,
          workflowInstanceId,
          error.reasonMessage,
          signalWasAlreadyAborted
        );
        this.logWorkflowRunError({
          phase: 'workflow-aborted',
          workflowId: definition.id,
          workflowInstanceId,
          recoveredStateAvailable: lastState !== initialState,
          error: abortDetail,
        });
        if (!terminalWorkflowEventEmitted) {
          emitRuntimeEvent?.({
            kind: 'workflow_cancelled',
            workflowId: definition.id,
            workflowInstanceId,
            message: abortDetail,
          } as RuntimeStreamEvent);
          terminalWorkflowEventEmitted = true;
        }
        return {
          state: lastState,
          aborted: true,
          abortedError: abortDetail,
          workflowId: definition.id,
          workflowInstanceId,
        };
      }

      // Check if the machine transitioned to #aborted (step-level onError).
      // Log the captured error so it's visible on the console.
      const snapshot = actorHandle.getSnapshot() as {
        value: unknown;
        status: string;
        context: WorkflowMachineContext<TState>;
      };
      const ctx = snapshot.context as WorkflowMachineContext<TState>;
      if (ctx.aborted && ctx.abortedError) {
        this.logWorkflowAbortError(ctx, ctx.abortedError);
        if (!terminalWorkflowEventEmitted) {
          emitRuntimeEvent?.({
            kind: 'workflow_failed',
            workflowId: definition.id,
            workflowInstanceId,
            ...(ctx.abortedStepId ? { stepId: ctx.abortedStepId } : {}),
            message: ctx.abortedError,
          } as RuntimeStreamEvent);
          terminalWorkflowEventEmitted = true;
        }
        return {
          state: ctx.state,
          aborted: true,
          abortedError: ctx.abortedError,
          workflowId: definition.id,
          workflowInstanceId,
          stepId: ctx.abortedStepId,
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
        if (abortHandler && options?.signal) {
          options.signal.removeEventListener('abort', abortHandler);
        }
      }
    };

    return {
      id: actorHandle.id,
      getStatus: () => actorHandle.getStatus(),
      getSnapshotView: () => {
        const snapshot = actorHandle.getSnapshot() as {
          context: WorkflowMachineContext<TState>;
        };
        const deepest = this.resolveDeepestActiveInteraction(snapshot);
        return {
          state: snapshot.context.state,
          aborted: snapshot.context.aborted,
          ...(snapshot.context.abortedStepId ? { stepId: snapshot.context.abortedStepId } : {}),
          ...(deepest
            ? {
                interaction: {
                  sessionId: deepest.sessionId,
                  actorPath: deepest.actorPath,
                  ...(deepest.metadata ? { metadata: deepest.metadata } : {}),
                },
              }
            : snapshot.context.activeInteraction
              ? { interaction: snapshot.context.activeInteraction }
              : {}),
        };
      },
      getPersistedSnapshot: () => actorHandle.getPersistedSnapshot(),
      dispatch: (event) => actorHandle.dispatch(event),
      checkpoint: () => actorHandle.checkpoint(),
      cancel: async () => {
        await actorHandle.cancel();
        if (!terminalWorkflowEventEmitted) {
          emitRuntimeEvent?.({
            kind: 'workflow_cancelled',
            workflowId: definition.id,
            workflowInstanceId,
            message: 'Workflow cancelled by caller.',
          } as RuntimeStreamEvent);
          terminalWorkflowEventEmitted = true;
        }
      },
      waitForDone,
    };
  }

  async run<TState>(
    definition: WorkflowDefinition<TState>,
    initialState: TState,
    options?: WorkflowRunOptions
  ): Promise<WorkflowResult<TState>> {
    return (await this.start(definition, initialState, options)).waitForDone();
  }

  private compileMachine<TState>(
    definition: WorkflowDefinition<TState>,
    dependencies: WorkflowRuntimeDependencies
  ) {
    const actors = this.compileActors(definition, dependencies);
    const guards = this.compileGuards(definition);
    const states = this.compileStates(definition, dependencies);

    return setup({
      types: {} as {
        context: WorkflowMachineContext<TState>;
        input: {
          initialState: TState;
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
        workflowId: input.workflowId,
        workflowInstanceId: input.workflowInstanceId,
        aborted: false,
        abortedError: undefined,
        abortedStepId: undefined,
        loopIterations: {},
        workflowReturn: definition.return,
        workflowLastResult: undefined,
      }),
      initial: definition.steps[0]?.id ?? 'completed',
      output: ({ context }) => ({
        aborted: context.aborted,
        ...(context.abortedError ? { abortedError: context.abortedError } : {}),
        state: context.state,
        data: context.aborted ? undefined : this.toWorkflowDefinitionOutput(definition, context.state),
      }),
      states,
    });
  }

  private compileActors<TState>(
    definition: WorkflowDefinition<TState>,
    dependencies: WorkflowRuntimeDependencies
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
          dependencies.options?.commands?.[commandToken] ??
          this.getToolManager(dependencies.container).get(commandToken);

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
      if ('command' in step) {
        this.addWorkflowCommandActor(actors, step.command, step.id, dependencies);
      }
      if ('execute' in step && !('command' in step)) {
        const executeStep = step as WorkflowExecuteStep<TState>;
        actors[`execute_${step.id}`] = fromPromise(
          async ({
            input,
          }: {
            input: { state: TState; ctx: ExecutionContext };
          }) => {
            this.logExecutionContextDebug(input.ctx, {
              phase: 'execute-start',
            });
            const startedAt = Date.now();
            try {
              const result = await executeStep.execute(
                input.state,
                input.ctx,
                dependencies.container
              );
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

      if ('kind' in step && step.kind === 'chat') {
        this.addWorkflowChatActor(actors, step as WorkflowChatStep<TState>, dependencies);
      }

      // Handle loop steps recursively
      if ('kind' in step && step.kind === 'loop') {
        const loopStep = step as WorkflowLoopStep<TState>;
        this.addLoopActors(actors, loopStep, definition.id, dependencies);
      }
    }

    return actors;
  }

  private addLoopActors<TState>(
    actors: Record<string, AnyActorLogic>,
    loopStep: WorkflowLoopStep<TState>,
    workflowId: string,
    dependencies: WorkflowRuntimeDependencies
  ): void {
    for (const step of loopStep.steps) {
      if ('command' in step) {
        this.addWorkflowCommandActor(actors, step.command, `${loopStep.id}_${step.id}`, dependencies);
      }
      if ('execute' in step && !('command' in step)) {
        const executeStep = step as WorkflowExecuteStep<TState>;
        actors[`execute_${loopStep.id}_${step.id}`] = fromPromise(
          async ({
            input,
          }: {
            input: { state: TState; ctx: ExecutionContext };
          }) => {
            this.logExecutionContextDebug(input.ctx, {
              phase: 'execute-start',
            });
            const startedAt = Date.now();
            try {
              const result = await executeStep.execute(
                input.state,
                input.ctx,
                dependencies.container
              );
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
        this.addLoopActors(actors, step as WorkflowLoopStep<TState>, workflowId, dependencies);
      }
    }
  }

  private addWorkflowCommandActor(
    actors: Record<string, AnyActorLogic>,
    commandToken: string,
    stepId: string,
    dependencies: WorkflowRuntimeDependencies
  ): void {
    const command = this.resolveWorkflowCommand(commandToken, dependencies);
    if (!command) return;

    const adapter = this.commandActorAdapters.resolveWorkflow(command);
    if (!adapter) return;

    actors[this.getWorkflowCommandActorSource(stepId)] = adapter.toActorLogic(command, (definition) =>
        this.compileMachine(definition, dependencies)
      );
  }

  private addWorkflowChatActor<TState>(
    actors: Record<string, AnyActorLogic>,
    step: WorkflowChatStep<TState>,
    dependencies: WorkflowRuntimeDependencies
  ): void {
    actors[this.getWorkflowChatActorSource(step.id)] = createWorkflowChatActor({
      processTurn: async (input) => {
        const chatInput = input as WorkflowChatActorInput & { message: string };
        const dispatcher = dependencies.container.resolve(CORE_SERVICE_TOKENS.CommandDispatcher);
        const runtimeCtx = this.withRuntimeSignal(
          chatInput.executionContext ?? { history: [], sessionId: chatInput.sessionId },
          dependencies.options?.signal
        );
        const result = await dispatcher.dispatch(
          'chat-chat-direct-turn',
          {
            options: {
              message: chatInput.message,
              messageOrigin: 'developer',
              sessionId: chatInput.sessionId,
              workflowSystemPrompt: chatInput.systemPrompt,
              workflowToolAllowlist: chatInput.toolAllowlist,
              skipWorkflowInteractionRouting: true,
            },
          },
          runtimeCtx
        );

        if (result.status !== 'ok') {
          throw new Error(
            result.message
              || `Workflow chat step '${step.id}' failed to process child chat turn in session '${chatInput.sessionId}'.`
          );
        }
        const data = result.data as { text?: unknown } | undefined;
        return {
          ...(typeof data?.text === 'string' ? { assistantMessage: data.text } : {}),
        };
      },
      invoke: async (command, args, executionContext, kind) => {
        const cmd =
          dependencies.options?.commands?.[command] ??
          this.getToolManager(dependencies.container).get(command);
        if (!cmd) {
          throw new Error(`WorkflowRunner: command '${command}' not registered`);
        }
        const runtimeExecutionContext = this.withRuntimeSignal(
          executionContext ?? { history: [] },
          dependencies.options?.signal
        );
        const execute = () => cmd.execute(args ?? {}, runtimeExecutionContext);
        const runId = executionContext?.workflowInstanceId;
        if (kind === 'finalize' && this.operationJournal && runId) {
          return this.operationJournal.execute(
            runId,
            `finalize:${step.id}`,
            { command, args: args ?? {} },
            execute
          );
        }
        return execute();
      },
    });
  }

  private getCommandActorSource(
    commandToken: string,
    stepId: string,
    dependencies: WorkflowRuntimeDependencies
  ): string {
    return this.resolveWorkflowCommand(commandToken, dependencies)
      ? this.getWorkflowCommandActorSource(stepId)
      : 'executeCommand';
  }

  private getWorkflowCommandActorSource(stepId: string): string {
    return `workflowCommand_${stepId}`;
  }

  private getWorkflowChatActorSource(stepId: string): string {
    return `workflowChat_${stepId}`;
  }

  private getWorkflowChatInvocationId(stepId: string): string {
    return `workflowChatInvocation_${stepId}`;
  }

  private getWorkflowChatSessionId<TState>(
    context: WorkflowMachineContext<TState>,
    stepId: string,
    options?: WorkflowRunOptions
  ): string {
    return options?.executionContext?.sessionId ?? `${context.workflowInstanceId}:${stepId}`;
  }

  private resolveWorkflowCommand(
    commandToken: string,
    dependencies: WorkflowRuntimeDependencies
  ): IWorkflowCommand | undefined {
    const command =
      dependencies.options?.commands?.[commandToken] ??
      this.getToolManager(dependencies.container).get(commandToken);
    return command && isWorkflowCommand(command as ICommand) ? (command as IWorkflowCommand) : undefined;
  }

  private toWorkflowDefinitionOutput<TState>(
    definition: WorkflowDefinition<TState>,
    state: TState
  ): unknown {
    if (definition.result !== undefined) {
      return resolveTemplateData(definition.result, state as Record<string, unknown>);
    }
    return definition.toResult ? definition.toResult(state) : state;
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

  private compileStates<TState>(
    definition: WorkflowDefinition<TState>,
    dependencies: WorkflowRuntimeDependencies
  ): Record<string, any> {
    const states: Record<string, any> = {};

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      const nextStepId = definition.steps[i + 1]?.id ?? 'completed';

      if ('kind' in step && step.kind === 'loop') {
        states[step.id] = this.compileLoopState(
          step as WorkflowLoopStep<TState>,
          nextStepId,
          dependencies
        );
      } else if ('command' in step) {
        states[step.id] = this.compileCommandState(
          step as WorkflowCommandStep<TState>,
          nextStepId,
          dependencies
        );
      } else if ('kind' in step && step.kind === 'chat') {
        states[step.id] = this.compileChatState(
          step as WorkflowChatStep<TState>,
          nextStepId,
          dependencies
        );
      } else if ('kind' in step && step.kind === 'question') {
        states[step.id] = this.compileQuestionState(
          step as WorkflowQuestionStep<TState>,
          nextStepId,
          dependencies
        );
      } else if ('execute' in step) {
        states[step.id] = this.compileExecuteState(
          step as WorkflowExecuteStep<TState>,
          nextStepId,
          dependencies
        );
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

  private compileQuestionState<TState>(
    step: WorkflowQuestionStep<TState>,
    nextStepId: string,
    dependencies: WorkflowRuntimeDependencies
  ): any {
    const hasConditions = this.hasStepConditions(step);
    return {
      always: hasConditions
        ? [{ target: nextStepId, guard: { type: this.getStepSkipGuardType(step.id) } }]
        : undefined,
      entry: assign(({ context }: { context: WorkflowMachineContext<TState> }) => ({
        activeInteraction: {
          sessionId: dependencies.options?.executionContext?.sessionId ?? context.workflowInstanceId,
          actorPath: `workflowQuestion_${step.id}`,
          metadata: {
            kind: 'question' as const,
            prompt: String(
              resolveTemplateData(step.prompt, context.state as Record<string, unknown>) ?? ''
            ),
            response: {
              type: step.interaction.type,
              ...(step.interaction.options ? { options: step.interaction.options } : {}),
            },
          },
        },
      })),
      on: {
        ANSWER: {
          target: nextStepId,
          actions: assign(({ context, event }: any) => {
            const answer = event.answer;
            return {
              ...context,
              state: this.applyStepResult(step, context.state, answer),
              workflowLastResult: answer,
              activeInteraction: undefined,
            };
          }),
        },
      },
    };
  }

  private compileChatState<TState>(
    step: WorkflowChatStep<TState>,
    nextStepId: string,
    dependencies: WorkflowRuntimeDependencies
  ): any {
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
        id: this.getWorkflowChatInvocationId(step.id),
        src: this.getWorkflowChatActorSource(step.id),
        input: ({ context }: { context: WorkflowMachineContext<TState> }): WorkflowChatActorInput => {
          const state = context.state as Record<string, unknown>;
          const sessionId = this.getWorkflowChatSessionId(context, step.id, dependencies.options);
          const resolve = (value: unknown) =>
            resolveTemplateData(value as never, state) as Record<string, unknown> | undefined;
          const executionContext = this.createExecutionContext(context, step.id, dependencies.options);
          const { signal: _signal, ...persistedExecutionContext } = executionContext;

          return {
            sessionId,
            systemPrompt: String(resolve(step.chat.systemPrompt) ?? ''),
            toolAllowlist: [...step.chat.toolPolicy.allow],
            done: {
              command: step.done.command,
              ...(step.done.args ? { args: resolve(step.done.args) } : {}),
            },
            finalize: {
              command: step.finalize.command,
              ...(step.finalize.args ? { args: resolve(step.finalize.args) } : {}),
            },
            executionContext: persistedExecutionContext,
          };
        },
        onDone: [
          {
            guard: ({ event }: any) => this.isAbandonedChatOutput(event.output),
            target: '#aborted',
            actions: assign(({ context, event }: any) => ({
              ...context,
              aborted: true,
              abortedStepId: step.id,
              abortedError: `Workflow chat step '${step.id}' was abandoned via /back.`,
              activeInteraction: undefined,
              workflowLastResult: event.output,
            })),
          },
          {
            target: nextStepId,
            actions: assign(({ context, event }: any) => {
              const newState = this.applyStepResult(step, context.state, event.output);
              return {
                ...context,
                state: newState,
                workflowLastResult: event.output,
                activeInteraction: undefined,
              };
            }),
          },
        ],
        onError: {
          target: '#aborted',
          actions: assign({
            aborted: true,
            abortedStepId: step.id,
            abortedError: ({ event }: any) => this.toErrorMessage(event.error),
            activeInteraction: undefined,
          }),
        },
      },
      entry: assign(({ context }: { context: WorkflowMachineContext<TState> }) => ({
        activeInteraction: {
          sessionId: this.getWorkflowChatSessionId(context, step.id, dependencies.options),
          actorPath: this.getWorkflowChatInvocationId(step.id),
        },
      })),
      on: {
        CHAT_TURN: {
          actions: sendTo(this.getWorkflowChatInvocationId(step.id), ({ event }) => event),
        },
        RETURN_ATTEMPT: {
          actions: sendTo(this.getWorkflowChatInvocationId(step.id), ({ event }) => event),
        },
        BACK_ATTEMPT: {
          actions: sendTo(this.getWorkflowChatInvocationId(step.id), ({ event }) => event),
        },
      },
    };
  }

  private compileCommandState<TState>(
    step: WorkflowCommandStep<TState>,
    nextStepId: string,
    dependencies: WorkflowRuntimeDependencies
  ): any {
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
        id: this.getWorkflowCommandActorSource(step.id),
        src: this.getCommandActorSource(step.command, step.id, dependencies),
        input: ({ context }: { context: WorkflowMachineContext<TState> }) => ({
          commandToken: step.command,
          params: this.resolveParams(step, context.state),
          ctx: this.createExecutionContext(context, step.id, dependencies.options),
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
            abortedStepId: step.id,
            abortedError: ({ event }: any) => this.toErrorMessage(event.error),
          }),
        },
      },
    };
  }

  private compileExecuteState<TState>(
    step: WorkflowExecuteStep<TState>,
    nextStepId: string,
    dependencies: WorkflowRuntimeDependencies
  ): any {
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
          ctx: this.createExecutionContext(context, step.id, dependencies.options),
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
            abortedStepId: step.id,
            abortedError: ({ event }: any) => this.toErrorMessage(event.error),
          }),
        },
      },
    };
  }

  private compileLoopState<TState>(
    loopStep: WorkflowLoopStep<TState>,
    nextStepId: string,
    dependencies: WorkflowRuntimeDependencies
  ): any {
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
          loopStep.id,
          dependencies
        );
      } else if ('execute' in step) {
        loopBodyStates[step.id] = this.compileLoopExecuteState(
          step as WorkflowExecuteStep<TState>,
          nextBodyStepId,
          loopStep.id,
          dependencies
        );
      } else if ('kind' in step && step.kind === 'loop') {
        // Nested loop - recursively compile
        loopBodyStates[step.id] = this.compileLoopState(
          step as WorkflowLoopStep<TState>,
          nextBodyStepId,
          dependencies
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
    loopId: string,
    dependencies: WorkflowRuntimeDependencies
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
        src: this.getCommandActorSource(step.command, stepId, dependencies),
        input: ({ context }: { context: WorkflowMachineContext<TState> }) => ({
          commandToken: step.command,
          params: this.resolveParams(step, context.state, context.loopIterations[loopId]),
          ctx: this.createExecutionContext(context, stepId, dependencies.options),
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
            abortedStepId: stepId,
            abortedError: ({ event }: any) => this.toErrorMessage(event.error),
          }),
        },
      },
    };
  }

  private compileLoopExecuteState<TState>(
    step: WorkflowExecuteStep<TState>,
    nextStepId: string,
    loopId: string,
    dependencies: WorkflowRuntimeDependencies
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
          ctx: this.createExecutionContext(context, stepId, dependencies.options),
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
            abortedStepId: stepId,
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

  private isAbandonedChatOutput(output: unknown): boolean {
    return (
      typeof output === 'object' &&
      output !== null &&
      (output as { abandoned?: unknown }).abandoned === true
    );
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
    step: Pick<WorkflowCommandStep<TState>, 'id' | 'applyResult'>,
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
    stepId: string,
    options?: WorkflowRunOptions
  ): ExecutionContext {
    const base = options?.executionContext ?? { history: [] };
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
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
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

  private withRuntimeSignal(
    executionContext: ExecutionContext,
    signal: AbortSignal | undefined
  ): ExecutionContext {
    if (!signal || executionContext.signal) {
      return executionContext;
    }
    return {
      ...executionContext,
      signal,
    };
  }

  private getToolManager(container: IServiceContainer): IToolManager {
    return container.resolve(CORE_SERVICE_TOKENS.ToolManager);
  }

  private logWorkflowAbortError<TState>(
    context: WorkflowMachineContext<TState>,
    errorMessage: string
  ): void {
    const backendLogService = this.backendLogService;
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

  private logWorkflowRunError(entry: Record<string, unknown>): void {
    this.backendLogService.write({
      source: 'workflow-runner',
      level: 'error',
      ...entry,
    });
  }

  private describeWorkflowAbort(
    workflowId: string,
    workflowInstanceId: string,
    reason: string | undefined,
    signalWasAlreadyAborted: boolean
  ): string {
    const location = `workflow '${workflowId}' (run ${workflowInstanceId})`;
    const normalizedReason = reason?.trim();
    const genericReason =
      !normalizedReason
      || /^workflow aborted$/i.test(normalizedReason)
      || /^this operation was aborted$/i.test(normalizedReason)
      || /^aborterror:?\s*this operation was aborted$/i.test(normalizedReason);

    if (signalWasAlreadyAborted) {
      return genericReason
        ? `Could not start ${location}: the request signal was already aborted.`
        : `Could not start ${location}: ${normalizedReason}`;
    }

    return genericReason
      ? `Execution of ${location} was interrupted without an abort reason.`
      : `Execution of ${location} was interrupted: ${normalizedReason}`;
  }

  private describeStepFailure(
    workflowId: string,
    workflowInstanceId: string,
    stepId: string | undefined,
    reason: string | undefined
  ): string {
    const location = stepId
      ? `step '${stepId}' of workflow '${workflowId}'`
      : `workflow '${workflowId}'`;
    const run = `(run ${workflowInstanceId})`;
    return reason?.trim()
      ? `${location} ${run} failed: ${reason.trim()}`
      : `${location} ${run} reached the aborted state without an error reason.`;
  }

  private logWorkflowDebug<TState>(
    context: WorkflowMachineContext<TState>,
    entry: Record<string, unknown>
  ): void {
    const backendLogService = this.backendLogService;
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

  private resolveRuntimeEventEmitter(
    options?: WorkflowRunOptions
  ): ((event: RuntimeStreamEvent) => void) | undefined {
    if (options?.emit) {
      return options.emit;
    }
    const emitService = this.container.tryResolve(CORE_SERVICE_TOKENS.EmitService) as
      | IEmitService
      | undefined;
    return emitService?.emit?.bind(emitService);
  }

  private resolveDeepestActiveInteraction(snapshot: unknown): {
    sessionId: string;
    actorPath: string;
    metadata?: {
      kind: 'chat' | 'question';
      prompt?: string;
      response?: { type: 'text' | 'select'; options?: Array<{ value: string; label: string }> };
    };
  } | undefined {
    type Interaction = WorkflowMachineContext<unknown>['activeInteraction'];
    type Candidate = { path: string; interaction: NonNullable<Interaction>; depth: number };

    const visit = (node: unknown, path: string, depth: number): Candidate | undefined => {
      const snapshotRecord =
        node && typeof node === 'object' ? (node as Record<string, unknown>) : undefined;
      const contextRecord =
        snapshotRecord?.['context'] && typeof snapshotRecord['context'] === 'object'
          ? (snapshotRecord['context'] as Record<string, unknown>)
          : undefined;
      const interaction =
        contextRecord?.['activeInteraction']
        && typeof contextRecord['activeInteraction'] === 'object'
        && !Array.isArray(contextRecord['activeInteraction'])
          ? (contextRecord['activeInteraction'] as NonNullable<Interaction>)
          : undefined;
      const children =
        snapshotRecord?.['children'] && typeof snapshotRecord['children'] === 'object'
          ? (snapshotRecord['children'] as Record<string, { getSnapshot?: () => unknown }>)
          : undefined;
      let best = interaction ? { path, interaction, depth } : undefined;
      if (!children) return best;
      for (const [childId, childRef] of Object.entries(children)) {
        if (!childRef || typeof childRef.getSnapshot !== 'function') continue;
        const childSnapshot = childRef.getSnapshot();
        const actorId =
          typeof (childRef as { id?: unknown }).id === 'string'
            ? ((childRef as { id: string }).id as string)
            : childId;
        const childPath = path ? `${path}.${actorId}` : actorId;
        const candidate = visit(childSnapshot, childPath, depth + 1);
        if (!candidate) continue;
        if (!best || candidate.depth >= best.depth) {
          best = candidate;
        }
      }
      return best;
    };

    const deepest = visit(snapshot, '', 0);
    if (!deepest) return undefined;
    const actorPath = deepest.path || deepest.interaction.actorPath;
    if (!actorPath) return undefined;
    return {
      sessionId: deepest.interaction.sessionId,
      actorPath,
      ...(deepest.interaction.metadata ? { metadata: deepest.interaction.metadata } : {}),
    };
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
    version: _version,
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
    const workflowRunRepository = this.container.tryResolve(
      CORE_SERVICE_TOKENS.WorkflowRunRepository
    ) as IWorkflowRunRepository | undefined;
    const actorHost = (this.container.tryResolve(
      WORKFLOW_SERVICE_TOKENS.WorkflowActorHost
    ) as WorkflowActorHost | undefined) ??
      (workflowRunRepository ? new WorkflowActorHost(workflowRunRepository) : undefined);
    const commandActorAdapters = this.container.tryResolve(
      WORKFLOW_SERVICE_TOKENS.CommandActorAdapterResolver
    ) as CommandActorAdapterResolver | undefined;
    const operationJournal = this.container.tryResolve(
      WORKFLOW_SERVICE_TOKENS.WorkflowOperationJournal
    ) as WorkflowOperationJournal | undefined;

    return new WorkflowRunner(
      this.container,
      backendLogService,
      actorHost,
      commandActorAdapters,
      operationJournal
    );
  }

  asCommand<TState>(definition: WorkflowDefinition<TState>): IWorkflowCommand {
    const {
      id,
      version: _version,
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
      [workflowCommand]: true,
      definitionId: definition.id,
      definitionVersion: definition.version ?? '1',
      metadata: { ...descriptorFields, key: id },
      execute: (params: unknown, ctx: ExecutionContext): Promise<CommandResponse<unknown>> =>
        this.#runAsCommand(definition, params, ctx),
      getWorkflowDefinition: () => definition as WorkflowDefinition<unknown>,
      ...definitionProvider,
    };
  }

  async #runAsCommand<TState>(
    definition: WorkflowDefinition<TState>,
    params: unknown,
    ctx: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const initialState = definition.prepare ? definition.prepare(params) : (params as TState);
    const runner = this.create();
    if (this.#hasInteractiveChatStep(definition.steps)) {
      const existingRun = await this.#findActiveInteractiveRun(definition, ctx);
      if (existingRun) {
        this.#emitWorkflowRestoredEvent(definition, existingRun);
        return {
          status: 'ok',
          data: {
            workflowRunId: existingRun.id,
            status: existingRun.status,
          },
        };
      }
      const handle = await runner.start(definition, initialState, { executionContext: ctx });
      return {
        status: 'ok',
        data: {
          workflowRunId: handle.id,
          status: handle.getStatus(),
        },
      };
    }

    const runResult = await runner.run(definition, initialState, { executionContext: ctx });
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

  #emitWorkflowRestoredEvent<TState>(
    definition: WorkflowDefinition<TState>,
    run: WorkflowRunRecord
  ): void {
    const emitService = this.container.tryResolve(CORE_SERVICE_TOKENS.EmitService) as
      | IEmitService
      | undefined;
    emitService?.emit({
      kind: 'workflow_restored',
      workflowId: definition.id,
      workflowInstanceId: run.id,
      definitionVersion: run.definitionVersion,
    } as RuntimeStreamEvent);
  }

  #hasInteractiveChatStep<TState>(steps: WorkflowStep<TState>[]): boolean {
    return steps.some(
      (step) =>
        ('kind' in step && step.kind === 'chat') ||
        ('kind' in step && step.kind === 'loop' && this.#hasInteractiveChatStep(step.steps))
    );
  }

  async #findActiveInteractiveRun<TState>(
    definition: WorkflowDefinition<TState>,
    ctx: ExecutionContext
  ): Promise<WorkflowRunRecord | undefined> {
    if (!ctx.sessionId) return undefined;

    const repository = this.container.tryResolve(
      CORE_SERVICE_TOKENS.WorkflowRunRepository
    ) as IWorkflowRunRepository | undefined;
    const activeRun = await repository?.findActiveBySession(ctx.sessionId);
    if (!activeRun) return undefined;

    if (
      activeRun.definitionId !== definition.id ||
      activeRun.definitionVersion !== (definition.version ?? '1')
    ) {
      throw new Error(
        `Session '${ctx.sessionId}' already has active workflow '${activeRun.definitionId}'.`
      );
    }
    return activeRun;
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

interface WorkflowRuntimeDependencies {
  container: IServiceContainer;
  options?: WorkflowRunOptions;
}
