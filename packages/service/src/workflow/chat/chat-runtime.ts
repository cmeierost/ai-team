import {
  type ChatLoopFailureInput,
  type ChatLoopHandoffTransitionResult,
  type ChatLoopInput,
  type ChatLoopOutput,
  type ChatLoopPostTurnResolutionResult,
  type ChatLoopPreturnResult,
  type ChatLoopToolRoundResult,
  type ChatLoopToolCall,
} from './chat-loop-contracts.js';
import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IServiceContainer,
  IWorkflowOperationRepository,
} from '@ai-team/core';
import { CORE_SERVICE_TOKENS } from '@ai-team/core';
import type { IWorkflowRunner } from '../index.js';
import type { WorkflowDefinition } from '../workflow-types.js';
import { HANDOFF_AUTO_REACT_MESSAGE } from './handoff-auto-react.js';
import { isWorkflowCommand } from '../workflow-command.js';

const WORKFLOW_TOOL_MAX_DEPTH = 4;

export interface ChatRuntimeTurnInput {
  userMessage: string;
  hop: number;
  agentId?: string;
  sessionId?: string;
  createNewSession?: boolean;
  options: {
    messageOrigin: 'developer' | 'internal';
  };
}

export interface ChatRuntimeTurnResult {
  text: string;
  toolRoundNeeded: boolean;
  /** Continue the XState loop after a slash command already switched agent/session. */
  followUpMessage?: string;
  pendingToolCall?: ChatLoopToolCall;
  handoffTargetId?: string;
  handoffTargetSessionId?: string;
  handoffNote?: string;
  handoffTargetWorkflowId?: string;
  handoffWorkflowToolPolicy?: {
    allow?: string[];
    deny?: string[];
    add?: string[];
    remove?: string[];
  };
  sourceToolCallId?: string;
  sourceSessionId?: string;
  agentId?: string;
  sessionId?: string;
}

export type IChatRuntimeStepCommand<TInput, TOutput> = ICommand<TInput, TOutput>;

export type ChatRuntimeStepName =
  | 'preturn'
  | 'sendTurn'
  | 'postTurnResolution'
  | 'handoffTransition'
  | 'toolRound'
  | 'failure';

export interface ChatRuntimeStepContractMap {
  preturn: IChatRuntimeStepCommand<{ message: string }, ChatLoopPreturnResult>;
  sendTurn: IChatRuntimeStepCommand<ChatRuntimeTurnInput, ChatRuntimeTurnResult>;
  postTurnResolution: IChatRuntimeStepCommand<
    {
      text: string;
      hop: number;
      handoffTargetId?: string;
      handoffTargetSessionId?: string;
      handoffNote?: string;
      handoffTargetWorkflowId?: string;
      handoffWorkflowToolPolicy?: {
        allow?: string[];
        deny?: string[];
        add?: string[];
        remove?: string[];
      };
    },
    ChatLoopPostTurnResolutionResult
  >;
  handoffTransition: IChatRuntimeStepCommand<
    {
      handoff: ChatLoopPostTurnResolutionResult;
      hop: number;
      fromAgentId?: string;
      fromSessionId?: string;
    },
    ChatLoopHandoffTransitionResult
  >;
  toolRound: IChatRuntimeStepCommand<
    { toolCall: ChatLoopToolCall; hop: number; lastText: string },
    ChatLoopToolRoundResult
  >;
  failure: IChatRuntimeStepCommand<ChatLoopFailureInput, void>;
}

export type ChatRuntimeStepResolver = (
  step: ChatRuntimeStepName
) => ChatRuntimeStepContractMap[ChatRuntimeStepName] | undefined;

export function createChatRuntimeStepCommand<TInput, TOutput>(
  step: ChatRuntimeStepName,
  executeAsync: (input: TInput, ctx: ExecutionContext) => Promise<TOutput>
): IChatRuntimeStepCommand<TInput, TOutput> {
  const metadata: ICommandDescriptor<TInput> = {
    key: `chat-runtime-step:${step}`,
    description: `Internal chat runtime step command: ${step}`,
    availableIn: { cli: false, chat: false, tool: false },
  };

  return {
    metadata,
    execute: async (params: TInput, _ctx: ExecutionContext): Promise<CommandResponse<TOutput>> => {
      const data = await executeAsync(params, _ctx);
      return { status: 'ok', data };
    },
  };
}

export interface ChatRuntimeRunInput extends ChatLoopInput {
  agentId?: string;
  sessionId?: string;
  createNewSession?: boolean;
  introduction?: boolean;
  contextFiles?: string[];
  signal?: AbortSignal;
  /** Depth counter for handoff subworkflows. Passed through to ExecutionContext to prevent nested handoffs. */
  subworkflowDepth?: number;
  workflowStack?: ExecutionContext['workflowStack'];
  workflowId?: string;
  workflowInstanceId?: string;
  invocationSurface?: ExecutionContext['invocationSurface'];
  calledByHuman?: boolean;
  callerType?: ExecutionContext['callerType'];
}

export interface IChatRuntime {
  runAsync(input: ChatRuntimeRunInput): Promise<ChatLoopOutput>;
}

interface ChatRuntimeState {
  input: ChatRuntimeRunInput;
  autoReactMessage: string;
  maxHops: number;
  hop: number;
  currentAgentId?: string;
  currentSessionId?: string;
  createNewSession?: boolean;
  currentMessage: string;
  currentMessageOrigin: 'developer' | 'internal';
  lastText: string;
  status: ChatLoopOutput['status'];
  done: boolean;
  error?: string;
  preturn?: ChatLoopPreturnResult;
  sendTurn?: ChatRuntimeTurnResult;
  toolRound?: ChatLoopToolRoundResult;
  postTurn?: ChatLoopPostTurnResolutionResult;
  handoff?: ChatLoopHandoffTransitionResult;
  shouldRunToolRound?: boolean;
  shouldRunDefaultToolRound?: boolean;
  shouldRunPostTurnResolution?: boolean;
  shouldRunHandoffTransition?: boolean;
  shouldContinueAppliedTransition?: boolean;
  selectedWorkflowTool?: string;
  workflowToolRawResult?: unknown;
}

export class ChatRuntime implements IChatRuntime {
  private readonly knownWorkflowToolTargets: readonly string[];

  constructor(
    private readonly resolveStep: ChatRuntimeStepResolver,
    private readonly workflowRunner: IWorkflowRunner,
    options?: { knownWorkflowToolTargets?: string[] }
  ) {
    const knownTargets = options?.knownWorkflowToolTargets ?? [];
    this.knownWorkflowToolTargets = [...new Set(knownTargets)].filter((target) => target.length > 0);
  }

  async runAsync(input: ChatRuntimeRunInput): Promise<ChatLoopOutput> {
    const preturnCommand = this.resolveRequired('preturn');
    const sendTurnCommand = this.resolveRequired('sendTurn');
    const postTurnResolutionCommand = this.resolveRequired('postTurnResolution');
    const handoffTransitionCommand = this.resolveRequired('handoffTransition');
    const toolRoundCommand = this.resolveOptional('toolRound');
    const failureCommand = this.resolveOptional('failure');

    const commands: Record<string, ICommand> = {
      [preturnCommand.metadata.key]: preturnCommand,
      [sendTurnCommand.metadata.key]: sendTurnCommand,
      [postTurnResolutionCommand.metadata.key]: postTurnResolutionCommand,
      [handoffTransitionCommand.metadata.key]: handoffTransitionCommand,
      ...(toolRoundCommand ? { [toolRoundCommand.metadata.key]: toolRoundCommand } : {}),
    };

    const initialState: ChatRuntimeState = {
      input,
      autoReactMessage: input.autoReactMessage ?? HANDOFF_AUTO_REACT_MESSAGE,
      maxHops: input.maxHops ?? 10,
      hop: 0,
      currentAgentId: input.agentId,
      currentSessionId: input.sessionId,
      createNewSession: input.createNewSession,
      currentMessage: input.message,
      currentMessageOrigin: 'developer',
      lastText: '',
      status: 'completed',
      done: false,
    };

    try {
      const definition = this.createWorkflowDefinition(
        preturnCommand,
        sendTurnCommand,
        postTurnResolutionCommand,
        handoffTransitionCommand,
        toolRoundCommand
      );

      const runResult = await this.workflowRunner.run(definition, initialState, {
        executionContext: this.createRunExecutionContext(input),
        signal: input.signal,
        commands,
      });

      if (runResult.aborted) {
        const failureId = runResult.workflowInstanceId;
        return {
          status: 'failed',
          text: runResult.state.lastText,
          hopCount: runResult.state.hop,
          error: runResult.abortedError ?? 'Workflow aborted',
          sessionId: runResult.state.currentSessionId,
          agentId: runResult.state.currentAgentId,
          failureId,
          errorDetails: {
            workflowId: runResult.workflowId,
            workflowInstanceId: runResult.workflowInstanceId,
            stepId: runResult.stepId,
          },
        };
      }

      return {
        status: runResult.state.status,
        text: runResult.state.lastText,
        hopCount: runResult.state.hop,
        error: runResult.state.error,
      };
    } catch (error) {
      const message = this.toErrorMessage(error);
      await this.runFailureAsync(
        failureCommand,
        {
          error: message,
          hop: initialState.hop,
          state: this.resolveFailureState(error),
        },
        input.signal
      );

      return {
        status: 'failed',
        text: initialState.lastText,
        hopCount: initialState.hop,
        error: message,
      };
    }
  }

  private createWorkflowDefinition(
    preturnCommand: ChatRuntimeStepContractMap['preturn'],
    sendTurnCommand: ChatRuntimeStepContractMap['sendTurn'],
    postTurnResolutionCommand: ChatRuntimeStepContractMap['postTurnResolution'],
    handoffTransitionCommand: ChatRuntimeStepContractMap['handoffTransition'],
    toolRoundCommand: ChatRuntimeStepContractMap['toolRound'] | undefined
  ): WorkflowDefinition<ChatRuntimeState> {
    const workflowToolPersistenceSteps = this.createWorkflowToolPersistenceSteps();
    const workflowToolSteps = this.createWorkflowToolInvocationSteps();
    const workflowToolResultSteps = this.createWorkflowToolResultSteps();
    return {
      id: 'chat-runtime-loop',
      version: '1',
      description: 'Run chat turn orchestration with workflow runner loop semantics',
      availableIn: { cli: false, chat: false, tool: false },
      return: {
        command: 'session-handoff-return',
      },
      steps: [
        {
          id: 'preturn',
          command: preturnCommand.metadata.key,
          params: (state) => ({ message: state.currentMessage }),
          applyResult: (state, raw) => {
            const preturn = this.unwrapStepResponse<ChatLoopPreturnResult>(raw, 'preturn');

            if (preturn.outcome === 'consumed') {
              return {
                ...state,
                preturn,
                done: true,
                status: 'completed',
                lastText: preturn.text ?? '',
              };
            }

            if (preturn.outcome === 'forwarded') {
              return {
                ...state,
                preturn,
                currentMessage: preturn.autoMessage ?? state.autoReactMessage,
                currentMessageOrigin: 'internal',
              };
            }

            return {
              ...state,
              preturn,
            };
          },
        },
        {
          kind: 'loop',
          id: 'chat-loop',
          while: 'done !== true',
          steps: [
            {
              id: 'sendTurn',
              command: sendTurnCommand.metadata.key,
              params: (state) => ({
                userMessage: state.currentMessage,
                hop: state.hop,
                agentId: state.currentAgentId,
                sessionId: state.currentSessionId,
                createNewSession: state.createNewSession,
                options: {
                  messageOrigin: state.currentMessageOrigin,
                },
              }),
              applyResult: (state, raw) => {
                const sendTurn = this.unwrapStepResponse<ChatRuntimeTurnResult>(raw, 'sendTurn');
                return {
                  ...state,
                  sendTurn,
                  toolRound: undefined,
                  postTurn: undefined,
                  handoff: undefined,
                  shouldRunToolRound: undefined,
                  shouldRunDefaultToolRound: undefined,
                  shouldRunPostTurnResolution: undefined,
                  shouldRunHandoffTransition: undefined,
                  shouldContinueAppliedTransition: Boolean(sendTurn.followUpMessage),
                  selectedWorkflowTool: undefined,
                  lastText: sendTurn.text,
                  currentMessage: sendTurn.followUpMessage ?? state.currentMessage,
                  currentMessageOrigin: sendTurn.followUpMessage
                    ? 'internal'
                    : state.currentMessageOrigin,
                  hop: sendTurn.followUpMessage ? state.hop + 1 : state.hop,
                  currentAgentId: sendTurn.agentId ?? state.currentAgentId,
                  currentSessionId: sendTurn.sessionId ?? state.currentSessionId,
                  createNewSession: false,
                };
              },
            },
            {
              id: 'validateToolRoundRequest',
              execute: async (state) => {
                if (state.sendTurn?.toolRoundNeeded && !state.sendTurn.pendingToolCall) {
                  return {
                    ...state,
                    done: true,
                    status: 'failed',
                    error: 'Tool round requested without pending tool call.',
                  };
                }
                return state;
              },
            },
            {
              id: 'computeToolRoundExecution',
              execute: async (state) => {
                const shouldRunToolRound =
                  !state.done &&
                  state.sendTurn?.toolRoundNeeded === true &&
                  Boolean(state.sendTurn?.pendingToolCall);
               const pendingToolName = state.sendTurn?.pendingToolCall?.toolName;
               const selectedWorkflowTool =
                 shouldRunToolRound &&
                 typeof pendingToolName === 'string' &&
                 this.knownWorkflowToolTargets.includes(pendingToolName)
                   ? pendingToolName
                   : undefined;

               return {
                 ...state,
                 shouldRunToolRound,
                 shouldRunDefaultToolRound: shouldRunToolRound && !selectedWorkflowTool,
                 selectedWorkflowTool,
               };
              },
            },
            ...this.createWorkflowToolPolicyGuardSteps(),
            ...workflowToolPersistenceSteps,
            ...workflowToolSteps,
            ...workflowToolResultSteps,
            {
              id: 'toolRound',
              command: toolRoundCommand?.metadata.key ?? 'chat-runtime-step:toolRound',
              skipWhen: 'shouldRunDefaultToolRound != true',
              params: (state) => ({
               toolCall: state.sendTurn!.pendingToolCall!,
               hop: state.hop,
                lastText: state.lastText,
              }),
              applyResult: (state, raw) => {
                const toolRound = this.unwrapStepResponse<ChatLoopToolRoundResult>(
                  raw,
                  'toolRound'
                );
                return {
                  ...state,
                  toolRound,
                };
              },
            },
            {
              id: 'resolveToolRound',
              execute: async (state) => {
                if (!state.sendTurn?.toolRoundNeeded) {
                  return state;
                }

                const toolRound = state.toolRound;
                if (!toolRound) {
                  if (!toolRoundCommand) {
                    return {
                      ...state,
                      done: true,
                      status: 'failed',
                      error: 'No tool round service configured.',
                    };
                  }
                  return state;
                }

                if (toolRound.outcome === 'resume_llm') {
                  const resumeMessage = toolRound.resumeMessage ?? state.currentMessage;
                  return {
                    ...state,
                    sendTurn: undefined,
                    toolRound: undefined,
                    postTurn: undefined,
                    shouldContinueAppliedTransition: true,
                    currentMessage: resumeMessage,
                    currentMessageOrigin: 'internal',
                    hop: state.hop + 1,
                    workflowToolRawResult: undefined,
                  };
                }

                if (toolRound.outcome === 'tool_failed') {
                  return {
                    ...state,
                    done: true,
                    status: 'failed',
                    error: toolRound.error ?? 'Tool round failed.',
                  };
                }

                return state;
              },
            },
            {
              id: 'computePostTurnExecution',
              execute: async (state) => {
                const shouldRunPostTurnResolution =
                  !state.done &&
                  state.shouldContinueAppliedTransition !== true &&
                  !(
                    state.sendTurn?.toolRoundNeeded === true &&
                    state.toolRound?.outcome === 'resume_llm'
                  );

                return {
                  ...state,
                  shouldRunPostTurnResolution,
                };
              },
            },
            {
              id: 'postTurnResolution',
              command: postTurnResolutionCommand.metadata.key,
              skipWhen: 'shouldRunPostTurnResolution != true',
              params: (state) => ({
                text: state.lastText,
                hop: state.hop,
                handoffTargetId: state.sendTurn?.handoffTargetId,
                handoffTargetSessionId: state.sendTurn?.handoffTargetSessionId,
                handoffNote: state.sendTurn?.handoffNote,
                handoffTargetWorkflowId: state.sendTurn?.handoffTargetWorkflowId,
                handoffWorkflowToolPolicy: state.sendTurn?.handoffWorkflowToolPolicy,
                sourceToolCallId: state.sendTurn?.sourceToolCallId,
                sourceSessionId: state.sendTurn?.sourceSessionId,
              }),
              applyResult: (state, raw) => {
                const postTurn = this.unwrapStepResponse<ChatLoopPostTurnResolutionResult>(
                  raw,
                  'postTurnResolution'
                );
                return {
                  ...state,
                  postTurn,
                };
              },
            },
            {
              id: 'resolvePostTurn',
              execute: async (state) => {
                if (state.done || !state.postTurn) {
                  return state;
                }

                if (state.postTurn.outcome === 'normal_complete') {
                  return {
                    ...state,
                    done: true,
                    status: 'completed',
                  };
                }

                if (state.hop >= state.maxHops) {
                  return {
                    ...state,
                    done: true,
                    status: 'max_hops_reached',
                  };
                }

                return state;
              },
            },
            {
              id: 'computeHandoffExecution',
              execute: async (state) => {
                const shouldRunHandoffTransition =
                  !state.done &&
                  state.postTurn?.outcome === 'handoff_required' &&
                  state.hop < state.maxHops;

                return {
                  ...state,
                  shouldRunHandoffTransition,
                };
              },
            },
            {
              id: 'handoffTransition',
              command: handoffTransitionCommand.metadata.key,
              skipWhen: 'shouldRunHandoffTransition != true',
              params: (state) => ({
                handoff: state.postTurn!,
                hop: state.hop,
                fromAgentId: state.currentAgentId,
                fromSessionId: state.currentSessionId,
              }),
              applyResult: (state, raw) => {
                const handoff = this.unwrapStepResponse<ChatLoopHandoffTransitionResult>(
                  raw,
                  'handoffTransition'
                );
                return {
                  ...state,
                  handoff,
                  currentMessage: handoff.autoMessage ?? state.autoReactMessage,
                  currentMessageOrigin: 'internal',
                  hop: state.hop + 1,
                  currentAgentId: handoff.agentId ?? state.currentAgentId,
                  currentSessionId: handoff.sessionId ?? state.currentSessionId,
                  createNewSession: false,
                  sendTurn: undefined,
                  toolRound: undefined,
                  postTurn: undefined,
                  shouldRunToolRound: undefined,
                  shouldRunDefaultToolRound: undefined,
                  shouldRunPostTurnResolution: undefined,
                  shouldRunHandoffTransition: undefined,
                  shouldContinueAppliedTransition: undefined,
                  selectedWorkflowTool: undefined,
                };
              },
            },
          ],
        },
      ],
    };
  }

  private resolveRequired<TStep extends ChatRuntimeStepName>(
    step: TStep
  ): ChatRuntimeStepContractMap[TStep] {
    const resolved = this.resolveStep(step) as ChatRuntimeStepContractMap[TStep] | undefined;
    if (!resolved) {
      throw new Error(`Missing required chat runtime step command: ${step}`);
    }
    return resolved;
  }

  private resolveOptional<TStep extends ChatRuntimeStepName>(
    step: TStep
  ): ChatRuntimeStepContractMap[TStep] | undefined {
    return this.resolveStep(step) as ChatRuntimeStepContractMap[TStep] | undefined;
  }

  private async executeCommand<TInput, TOutput>(
    command: IChatRuntimeStepCommand<TInput, TOutput>,
    step: ChatRuntimeStepName,
    params: TInput,
    signal?: AbortSignal
  ): Promise<TOutput> {
    const response = await command.execute(params, this.createStepExecutionContext(step, signal));
    if (response.status !== 'ok') {
      throw new Error(response.message ?? `Chat runtime step failed: ${step}`);
    }
    return response.data as TOutput;
  }

  private async runFailureAsync(
    failureCommand: ChatRuntimeStepContractMap['failure'] | undefined,
    input: ChatLoopFailureInput,
    signal?: AbortSignal
  ): Promise<void> {
    if (!failureCommand) {
      return;
    }

    await this.executeCommand(failureCommand, 'failure', input, signal);
  }

  private unwrapStepResponse<T>(raw: unknown, step: ChatRuntimeStepName): T {
    const response = raw as CommandResponse<T>;
    if (response?.status !== 'ok') {
      throw new Error(response?.message ?? `Chat runtime step failed: ${step}`);
    }
    return response.data as T;
  }

  private createStepExecutionContext(
    step: ChatRuntimeStepName,
    signal?: AbortSignal
  ): ExecutionContext {
    return {
      history: [],
      workflowId: 'chat-runtime',
      workflowInstanceId: 'chat-runtime',
      stepId: step,
      ...(signal ? { signal } : {}),
    };
  }

  private createRunExecutionContext(input: ChatRuntimeRunInput): ExecutionContext {
    return {
      ...this.createStepExecutionContext('sendTurn', input.signal),
      ...(input.subworkflowDepth !== undefined ? { subworkflowDepth: input.subworkflowDepth } : {}),
      ...(input.workflowStack ? { workflowStack: [...input.workflowStack] } : {}),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      ...(input.workflowInstanceId ? { workflowInstanceId: input.workflowInstanceId } : {}),
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

  private resolveFailureState(error: unknown): ChatLoopFailureInput['state'] {
    if (!(error instanceof Error)) {
      return 'sendTurn';
    }

    const lower = error.message.toLowerCase();
    if (lower.includes('preturn')) return 'preturn';
    if (lower.includes('postturn')) return 'postTurnResolution';
    if (lower.includes('handoff')) return 'handoffTransition';
    if (lower.includes('tool')) return 'toolRound';
    if (lower.includes('abort')) return 'aborted';
    return 'sendTurn';
  }

  private createWorkflowToolInvocationSteps(): WorkflowDefinition<ChatRuntimeState>['steps'] {
    return this.knownWorkflowToolTargets.map((toolName) => ({
      id: `workflowTool_${this.toWorkflowToolStepSuffix(toolName)}`,
      command: toolName,
      skipWhen: `selectedWorkflowTool != "${toolName}"`,
      params: (state: ChatRuntimeState) => ({
        toolCall: state.sendTurn!.pendingToolCall!,
        hop: state.hop,
        lastText: state.lastText,
      }),
      applyResult: (state: ChatRuntimeState, raw: unknown) => ({
        ...state,
        workflowToolRawResult: raw,
      }),
    }));
  }

  private createWorkflowToolPolicyGuardSteps(): WorkflowDefinition<ChatRuntimeState>['steps'] {
    return this.knownWorkflowToolTargets.map((toolName) => ({
      id: `validateWorkflowToolPolicy_${this.toWorkflowToolStepSuffix(toolName)}`,
      skipWhen: `selectedWorkflowTool != "${toolName}"`,
      execute: async (state: ChatRuntimeState, ctx: ExecutionContext, services: IServiceContainer) => {
        const rejection = this.evaluateWorkflowToolPolicy(toolName, ctx, services);
        if (!rejection) {
          return state;
        }
        const toolCallId = this.resolveToolCallId(state, toolName);
        return {
          ...state,
          selectedWorkflowTool: undefined,
          toolRound: this.toWorkflowToolRoundResult(
            {
              status: 'error',
              message: rejection.message,
              error: {
                code: rejection.code,
                details: {
                  policy: rejection.policy,
                  toolName,
                },
              },
            } as CommandResponse<unknown>,
            toolName,
            toolCallId
          ),
          workflowToolRawResult: undefined,
        };
      },
    }));
  }

  private createWorkflowToolResultSteps(): WorkflowDefinition<ChatRuntimeState>['steps'] {
    return this.knownWorkflowToolTargets.map((toolName) => ({
      id: `persistWorkflowToolResult_${this.toWorkflowToolStepSuffix(toolName)}`,
      skipWhen: `selectedWorkflowTool != "${toolName}"`,
      execute: async (state: ChatRuntimeState, ctx: ExecutionContext, services: IServiceContainer) =>
        this.persistWorkflowToolResultAsync(toolName, state, ctx, services),
    }));
  }

  private createWorkflowToolPersistenceSteps(): WorkflowDefinition<ChatRuntimeState>['steps'] {
    return this.knownWorkflowToolTargets.map((toolName) => ({
      id: `persistWorkflowToolStart_${this.toWorkflowToolStepSuffix(toolName)}`,
      skipWhen: `selectedWorkflowTool != "${toolName}"`,
      execute: async (state: ChatRuntimeState, ctx: ExecutionContext, services: IServiceContainer) => {
        await this.persistWorkflowToolStartAsync(toolName, state, ctx, services);
        return state;
      },
    }));
  }

  private toWorkflowToolStepSuffix(toolName: string): string {
    return toolName.replace(/[^a-zA-Z0-9]+/g, '_');
  }

  private toWorkflowToolRoundResult(
    raw: unknown,
    toolName: string,
    toolCallId: string
  ): ChatLoopToolRoundResult {
    const maybeResponse = raw as Partial<CommandResponse<unknown>> | null;
    if (maybeResponse && typeof maybeResponse === 'object' && typeof maybeResponse.status === 'string') {
      if (maybeResponse.status === 'error' || maybeResponse.status === 'cancelled') {
        return {
          outcome: 'resume_llm',
          toolCallId,
          toolName,
          resumeMessage: this.buildWorkflowToolResumeMessage({
            toolName,
            toolCallId,
            status: maybeResponse.status,
            output: maybeResponse.data,
            message: maybeResponse.message,
            error: maybeResponse.error,
          }),
        };
      }
      return {
        outcome: 'resume_llm',
        toolCallId,
        toolName,
        resumeMessage: this.buildWorkflowToolResumeMessage({
          toolName,
          toolCallId,
          status: 'ok',
          output: maybeResponse.data,
        }),
      };
    }
    return {
      outcome: 'resume_llm',
      toolCallId,
      toolName,
      resumeMessage: this.buildWorkflowToolResumeMessage({
        toolName,
        toolCallId,
        status: 'ok',
        output: raw,
      }),
    };
  }

  private resolveToolCallId(state: ChatRuntimeState, toolName: string): string {
    const toolCall = state.sendTurn?.pendingToolCall;
    return typeof toolCall?.toolCallId === 'string' && toolCall.toolCallId.trim().length > 0
      ? toolCall.toolCallId
      : `missing-tool-call-id:${state.hop}:${toolName}`;
  }

  private async persistWorkflowToolStartAsync(
    toolName: string,
    state: ChatRuntimeState,
    ctx: ExecutionContext,
    services: IServiceContainer
  ): Promise<void> {
    const operations = services.tryResolve(
      CORE_SERVICE_TOKENS.WorkflowOperationRepository
    ) as IWorkflowOperationRepository | undefined;
    if (!operations) {
      return;
    }

    const toolCallId = this.resolveToolCallId(state, toolName);
    const runId = ctx.workflowInstanceId ?? 'chat-runtime';
    const operationKey = `workflow-tool-start:${toolCallId}`;
    const childStepId = `workflowTool_${this.toWorkflowToolStepSuffix(toolName)}`;
    const childInvocationId = `workflowCommand_${childStepId}`;
    const toolManager = services.resolve(CORE_SERVICE_TOKENS.ToolManager);
    const command = toolManager.get(toolName);
    const definitionVersion =
      command && isWorkflowCommand(command) ? command.definitionVersion : undefined;
    const ancestry = (ctx.workflowStack ?? []).map((entry) => ({
      workflowId: entry.workflowId,
      workflowInstanceId: entry.workflowInstanceId,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
    }));
    const existing = await operations.get(runId, operationKey);
    const now = new Date().toISOString();

    await operations.save({
      runId,
      operationKey,
      status: 'started',
      input: {
        kind: 'workflow-tool-start',
        toolName,
        toolCallId,
        childInvocationId,
        input: {
          toolCall: state.sendTurn?.pendingToolCall,
          hop: state.hop,
          lastText: state.lastText,
        },
        depth: typeof ctx.subworkflowDepth === 'number' ? ctx.subworkflowDepth : 0,
        ancestry,
        ...(definitionVersion ? { definitionVersion } : {}),
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private async persistWorkflowToolResultAsync(
    toolName: string,
    state: ChatRuntimeState,
    ctx: ExecutionContext,
    services: IServiceContainer
  ): Promise<ChatRuntimeState> {
    const toolCallId = this.resolveToolCallId(state, toolName);
    const workflowToolRound = this.toWorkflowToolRoundResult(
      state.workflowToolRawResult,
      toolName,
      toolCallId
    );
    const operations = services.tryResolve(
      CORE_SERVICE_TOKENS.WorkflowOperationRepository
    ) as IWorkflowOperationRepository | undefined;
    if (!operations) {
      return {
        ...state,
        toolRound: workflowToolRound,
        workflowToolRawResult: undefined,
      };
    }

    const runId = ctx.workflowInstanceId ?? 'chat-runtime';
    const operationKey = `workflow-tool-result:${toolCallId}`;
    const now = new Date().toISOString();
    const existing = await operations.get(runId, operationKey);
    if (existing?.status === 'completed' && existing.output) {
      return {
        ...state,
        toolRound: existing.output as ChatLoopToolRoundResult,
        workflowToolRawResult: undefined,
      };
    }

    await operations.save({
      runId,
      operationKey,
      status: 'completed',
      input: {
        kind: 'workflow-tool-result',
        toolName,
        toolCallId,
      },
      output: workflowToolRound,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    const startOperationKey = `workflow-tool-start:${toolCallId}`;
    const start = await operations.get(runId, startOperationKey);
    if (start && start.status !== 'completed') {
      await operations.save({
        ...start,
        status: 'completed',
        output: workflowToolRound,
        updatedAt: now,
      });
    }

    return {
      ...state,
      toolRound: workflowToolRound,
      workflowToolRawResult: undefined,
    };
  }

  private buildWorkflowToolResumeMessage(input: {
    toolName: string;
    toolCallId: string;
    status: 'ok' | 'error' | 'cancelled';
    output?: unknown;
    message?: string;
    error?: { code?: string; details?: unknown };
  }): string {
    const { toolName, toolCallId, status, output, message, error } = input;
    return [
      '[Internal workflow tool result]',
      `tool_call_id: ${toolCallId}`,
      `tool_name: ${toolName}`,
      `status: ${
        status === 'ok' ? 'completed'
          : status === 'cancelled' ? 'cancelled'
          : 'failed'
      }`,
      ...(status !== 'ok' && message ? [`reason: ${message}`] : []),
      ...(status !== 'ok' && error?.code ? [`error_code: ${error.code}`] : []),
      ...(status !== 'ok' ? ['retry_allowed: true'] : []),
      'output:',
      this.serializeWorkflowToolOutput(
        status === 'ok'
          ? output
          : {
              message,
              ...(error?.code ? { code: error.code } : {}),
              ...(error?.details !== undefined ? { details: error.details } : {}),
              ...(output !== undefined ? { data: output } : {}),
            }
      ),
    ].join('\n');
  }

  private serializeWorkflowToolOutput(value: unknown): string {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return String(value);
    }
  }

  private evaluateWorkflowToolPolicy(
    toolName: string,
    ctx: ExecutionContext,
    services: IServiceContainer
  ): { policy: 'max_depth' | 'cycle'; code: string; message: string } | undefined {
    const depth = typeof ctx.subworkflowDepth === 'number'
      ? ctx.subworkflowDepth
      : (ctx.workflowStack?.length ?? 0);
    if (depth >= WORKFLOW_TOOL_MAX_DEPTH) {
      return {
        policy: 'max_depth',
        code: 'workflow_tool_max_depth_exceeded',
        message: `Workflow tool call rejected: maximum depth ${WORKFLOW_TOOL_MAX_DEPTH} reached.`,
      };
    }

    const toolManager = services.resolve(CORE_SERVICE_TOKENS.ToolManager);
    const command = toolManager.get(toolName);
    if (!command || !isWorkflowCommand(command)) {
      return undefined;
    }

    const activeLineage = new Set<string>(
      [
        ...(ctx.workflowId ? [ctx.workflowId] : []),
        ...(ctx.workflowStack ?? []).map((entry) => entry.workflowId).filter(Boolean),
      ]
    );
    if (!activeLineage.has(command.definitionId)) {
      return undefined;
    }

    return {
      policy: 'cycle',
      code: 'workflow_tool_cycle_detected',
      message: `Workflow tool call rejected: '${command.definitionId}' would create a workflow cycle.`,
    };
  }
}
