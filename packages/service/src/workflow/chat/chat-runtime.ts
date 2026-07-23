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
} from '@ai-team/core';
import type { IWorkflowRunner } from '../index.js';
import type { WorkflowDefinition } from '../workflow-types.js';
import { HANDOFF_AUTO_REACT_MESSAGE } from './handoff-auto-react.js';

export interface ChatRuntimeTurnInput {
  userMessage: string;
  hop: number;
  agentId?: string;
  sessionId?: string;
  createNewSession?: boolean;
  options: {
    skipPersist: boolean;
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
  executeAsync: (input: TInput) => Promise<TOutput>
): IChatRuntimeStepCommand<TInput, TOutput> {
  const metadata: ICommandDescriptor<TInput> = {
    key: `chat-runtime-step:${step}`,
    description: `Internal chat runtime step command: ${step}`,
    availableIn: { cli: false, chat: false, tool: false },
  };

  return {
    metadata,
    execute: async (params: TInput, _ctx: ExecutionContext): Promise<CommandResponse<TOutput>> => {
      const data = await executeAsync(params);
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
}

export interface IChatRuntime {
  runAsync(input: ChatRuntimeRunInput): Promise<ChatLoopOutput>;
}

interface ChatRuntimeState {
  input: ChatRuntimeRunInput;
  explicitAutoReactMessage?: string;
  autoReactMessage: string;
  maxHops: number;
  hop: number;
  currentAgentId?: string;
  currentSessionId?: string;
  createNewSession?: boolean;
  currentMessage: string;
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
  shouldRunPostTurnResolution?: boolean;
  shouldRunHandoffTransition?: boolean;
  shouldContinueAppliedTransition?: boolean;
}

export class ChatRuntime implements IChatRuntime {
  constructor(
    private readonly resolveStep: ChatRuntimeStepResolver,
    private readonly workflowRunner: IWorkflowRunner
  ) {}

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
      explicitAutoReactMessage: input.autoReactMessage,
      autoReactMessage: input.autoReactMessage ?? HANDOFF_AUTO_REACT_MESSAGE,
      maxHops: input.maxHops ?? 10,
      hop: 0,
      currentAgentId: input.agentId,
      currentSessionId: input.sessionId,
      createNewSession: input.createNewSession,
      currentMessage: input.message,
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
        executionContext: this.createStepExecutionContext('sendTurn', input.signal),
        signal: input.signal,
        commands,
      });

      if (runResult.aborted) {
        return {
          status: 'failed',
          text: runResult.state.lastText,
          hopCount: runResult.state.hop,
          error: 'Workflow aborted',
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
    return {
      id: 'chat-runtime-loop',
      description: 'Run chat turn orchestration with workflow runner loop semantics',
      availableIn: { cli: false, chat: false, tool: false },
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
                  skipPersist: this.shouldSkipPersist(
                    state.currentMessage,
                    state.hop,
                    state.explicitAutoReactMessage
                  ),
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
                  shouldRunPostTurnResolution: undefined,
                  shouldRunHandoffTransition: undefined,
                  shouldContinueAppliedTransition: Boolean(sendTurn.followUpMessage),
                  lastText: sendTurn.text,
                  currentMessage: sendTurn.followUpMessage ?? state.currentMessage,
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

                return {
                  ...state,
                  shouldRunToolRound,
                };
              },
            },
            {
              id: 'toolRound',
              command: toolRoundCommand?.metadata.key ?? 'chat-runtime-step:toolRound',
              skipWhen: 'shouldRunToolRound != true',
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

                if (!toolRoundCommand) {
                  return {
                    ...state,
                    done: true,
                    status: 'failed',
                    error: 'No tool round service configured.',
                  };
                }

                const toolRound = state.toolRound;
                if (!toolRound) {
                  return state;
                }

                if (toolRound.outcome === 'resume_llm') {
                  return {
                    ...state,
                    sendTurn: undefined,
                    toolRound: undefined,
                    postTurn: undefined,
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
                  hop: state.hop + 1,
                  currentAgentId: handoff.agentId ?? state.currentAgentId,
                  currentSessionId: handoff.sessionId ?? state.currentSessionId,
                  createNewSession: false,
                  sendTurn: undefined,
                  toolRound: undefined,
                  postTurn: undefined,
                  shouldRunToolRound: undefined,
                  shouldRunPostTurnResolution: undefined,
                  shouldRunHandoffTransition: undefined,
                  shouldContinueAppliedTransition: undefined,
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

  private shouldSkipPersist(
    message: string,
    hop: number,
    explicitAutoReactMessage?: string
  ): boolean {
    if (hop > 0) {
      return true;
    }

    if (!explicitAutoReactMessage) {
      return false;
    }

    return message === explicitAutoReactMessage;
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
}
