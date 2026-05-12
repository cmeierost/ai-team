import type { Agent, IContainerToken, IServiceContainer, ExecutionContext } from '@ai-team/core';
import type {
  WorkflowDefinitionDocument,
  WorkflowDefinitionState,
  WorkflowDefinitionTransition,
} from '@ai-team/api-contracts';
import { inspect } from 'node:util';
import { assign, createActor, fromPromise, setup, toPromise } from 'xstate';

import type { ToolManager } from '../tools/tool-manager.js';
import { workflowDefinitionJsonToYaml } from './definition-format.js';
import {
  parseChatHandoffTransitionResult,
  parseChatPostTurnResolutionResult,
  parseChatPreturnResult,
  parseChatSendTurnResult,
  parseChatToolRoundResult,
  type ChatHandoffTransitionResult,
  type ChatPostTurnResolutionResult,
  type ChatPreturnResult,
  type ChatSendTurnResult,
  type ChatToolCall,
  type ChatToolRoundResult,
} from './chat-loop-contracts.js';

const DEFAULT_MAX_HOPS = 10;
const DEFAULT_AUTO_REACT_MESSAGE =
  '[Handoff received] You have just been handed this conversation. Review the briefing above, acknowledge the context, and ask the developer how they would like to proceed.';

function createWorkflowToken<T>(id: string): IContainerToken<T> {
  return {
    id,
    toString: () => `Token(${id})`,
  } as IContainerToken<T>;
}

export interface ChatLoopToolRoundExecutionRequest {
  toolCall: ChatToolCall;
  hop: number;
  lastText: string;
}

export interface ChatLoopToolRoundExecutor {
  executeAsync(request: ChatLoopToolRoundExecutionRequest): Promise<ChatToolRoundResult>;
}

export const WORKFLOW_ENGINE_TOKENS = {
  ChatLoopToolRoundExecutor: createWorkflowToken<ChatLoopToolRoundExecutor>(
    'WorkflowEngine.ChatLoopToolRoundExecutor'
  ),
} as const;

export interface ChatLoopToolingContext {
  agent: Agent;
  toolManager: ToolManager;
  toolContext: Omit<ExecutionContext, 'agent'>;
  resolver?: IServiceContainer;
}

export interface ChatLoopWorkflowInput {
  message: string;
  maxHops?: number;
  autoReactMessage?: string;
}

export interface ChatLoopWorkflowOutput {
  status: 'completed' | 'failed' | 'max_hops_reached';
  text: string;
  hopCount: number;
  error?: string;
}

export interface ChatLoopWorkflowServices {
  runPreturnInterceptorsAsync(input: { message: string }): Promise<ChatPreturnResult>;
  runSendTurnAsync(input: { message: string; hop: number }): Promise<ChatSendTurnResult>;
  runPostTurnResolutionAsync(input: {
    text: string;
    hop: number;
  }): Promise<ChatPostTurnResolutionResult>;
  runHandoffTransitionAsync(input: {
    handoff: ChatPostTurnResolutionResult;
    hop: number;
  }): Promise<ChatHandoffTransitionResult>;
  runToolRoundAsync?(request: ChatLoopToolRoundExecutionRequest): Promise<ChatToolRoundResult>;
  runFailureAsync?(input: { error: string; hop: number; state: string }): Promise<void> | void;
}

export interface ChatLoopMachineOptions {
  tooling?: ChatLoopToolingContext;
}

export type ChatLoopWorkflowTransitionJson = WorkflowDefinitionTransition;

export type ChatLoopWorkflowStateJson = WorkflowDefinitionState;

export type ChatLoopWorkflowDefinitionJson = WorkflowDefinitionDocument;

interface ChatLoopMachineContext {
  currentMessage: string;
  maxHops: number;
  hop: number;
  autoReactMessage: string;
  lastText: string;
  preturn?: ChatPreturnResult;
  sendTurn?: ChatSendTurnResult;
  pendingToolCall?: ChatToolCall;
  toolRound?: ChatToolRoundResult;
  postTurn?: ChatPostTurnResolutionResult;
  errorMessage?: string;
  failureState?: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized) {
      return serialized;
    }
  } catch {
    // no-op; fall through to inspect
  }

  return inspect(error, { depth: 1, breakLength: Infinity });
}

async function executeToolRoundFromRegistryAsync(
  request: ChatLoopToolRoundExecutionRequest,
  tooling: ChatLoopToolingContext
): Promise<ChatToolRoundResult> {
  const { toolCall } = request;
  const resolvedFromRegistry = tooling.toolManager.get(toolCall.toolName);

  if (resolvedFromRegistry) {
    const execution = await tooling.toolManager.execute(
      tooling.agent,
      toolCall.toolName,
      toolCall.args,
      tooling.toolContext
    );

    if (!execution.ok) {
      return {
        outcome: 'tool_failed',
        error: execution.error ?? `Tool execution failed for ${toolCall.toolName}`,
      };
    }

    return { outcome: 'tool_complete' };
  }

  const delegatedExecutor = tooling.resolver?.tryResolve(
    WORKFLOW_ENGINE_TOKENS.ChatLoopToolRoundExecutor
  );
  if (delegatedExecutor) {
    return delegatedExecutor.executeAsync(request);
  }

  return {
    outcome: 'tool_failed',
    error:
      `Tool '${toolCall.toolName}' is not registered in ToolManager and no ` +
      `${WORKFLOW_ENGINE_TOKENS.ChatLoopToolRoundExecutor.id} resolver is configured.`,
  };
}

function resolveToolRoundService(
  services: ChatLoopWorkflowServices,
  options?: ChatLoopMachineOptions
): (request: ChatLoopToolRoundExecutionRequest) => Promise<ChatToolRoundResult> {
  if (services.runToolRoundAsync) {
    return services.runToolRoundAsync;
  }

  const tooling = options?.tooling;
  if (!tooling) {
    return async () => ({
      outcome: 'tool_failed',
      error: 'No tool round service is configured and no tooling context was provided.',
    });
  }

  return (request) => executeToolRoundFromRegistryAsync(request, tooling);
}

const DEFINITION_INTROSPECTION_SERVICES: ChatLoopWorkflowServices = {
  runPreturnInterceptorsAsync: async () => ({ outcome: 'continue' }),
  runSendTurnAsync: async () => ({ text: '', toolRoundNeeded: false }),
  runPostTurnResolutionAsync: async () => ({ outcome: 'normal_complete' }),
  runHandoffTransitionAsync: async () => ({}),
};

function asTransitionArray(value: unknown): Array<Record<string, unknown>> {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => !!entry && !!entry.target);
  }

  if (typeof value === 'object') {
    const single = value as Record<string, unknown>;
    return single.target ? [single] : [];
  }

  return [];
}

function readTransitionTarget(transition: Record<string, unknown>): string | undefined {
  const target = transition.target;
  if (typeof target === 'string') {
    return target;
  }

  if (Array.isArray(target)) {
    const first = target[0];
    return typeof first === 'string' ? first : undefined;
  }

  return undefined;
}

function readTransitionGuard(transition: Record<string, unknown>): string | undefined {
  const guard = transition.guard;
  if (typeof guard === 'string') {
    return guard;
  }

  if (guard && typeof guard === 'object') {
    const typedGuard = (guard as { type?: unknown }).type;
    return typeof typedGuard === 'string' ? typedGuard : undefined;
  }

  return undefined;
}

function appendTransitions(
  target: ChatLoopWorkflowTransitionJson[],
  event: string,
  transitions: unknown
) {
  for (const transition of asTransitionArray(transitions)) {
    const targetState = readTransitionTarget(transition);
    if (!targetState) {
      continue;
    }

    const guard = readTransitionGuard(transition);
    target.push({
      event,
      target: targetState,
      ...(guard ? { guard } : {}),
    });
  }
}

function normalizeInvokeEntries(
  stateConfig: Record<string, unknown>
): Array<Record<string, unknown>> {
  if (!stateConfig.invoke) {
    return [];
  }

  if (Array.isArray(stateConfig.invoke)) {
    return stateConfig.invoke.filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object'
    );
  }

  if (typeof stateConfig.invoke === 'object') {
    return [stateConfig.invoke as Record<string, unknown>];
  }

  return [];
}

function resolveInvokeSource(invokeEntries: Array<Record<string, unknown>>): string | undefined {
  const firstInvokeEntry = invokeEntries[0];
  if (!firstInvokeEntry) {
    return undefined;
  }

  const src = (firstInvokeEntry as { src?: unknown }).src;
  return typeof src === 'string' ? src : undefined;
}

function serializeStateTransitions(
  stateConfig: Record<string, unknown>
): ChatLoopWorkflowTransitionJson[] {
  const transitions: ChatLoopWorkflowTransitionJson[] = [];

  appendTransitions(transitions, 'always', stateConfig.always);

  if (stateConfig.on && typeof stateConfig.on === 'object') {
    for (const [event, eventTransition] of Object.entries(
      stateConfig.on as Record<string, unknown>
    )) {
      appendTransitions(transitions, event, eventTransition);
    }
  }

  for (const invokeConfig of normalizeInvokeEntries(stateConfig)) {
    appendTransitions(transitions, 'done', invokeConfig.onDone);
    appendTransitions(transitions, 'error', invokeConfig.onError);
  }

  return transitions;
}

function serializeStateConfig(stateConfig: Record<string, unknown>): ChatLoopWorkflowStateJson {
  const invokeEntries = normalizeInvokeEntries(stateConfig);
  const invokeSource = resolveInvokeSource(invokeEntries);

  return {
    ...(stateConfig.type === 'final' ? { type: 'final' as const } : {}),
    ...(invokeSource ? { invoke: { src: invokeSource } } : {}),
    transitions: serializeStateTransitions(stateConfig),
  };
}

function serializeMachineStates(
  configStates?: Record<string, Record<string, unknown>>
): Record<string, ChatLoopWorkflowStateJson> {
  const states: Record<string, ChatLoopWorkflowStateJson> = {};
  for (const [stateId, stateConfig] of Object.entries(configStates ?? {})) {
    states[stateId] = serializeStateConfig(stateConfig);
  }
  return states;
}

export function getChatLoopWorkflowDefinitionJson(): ChatLoopWorkflowDefinitionJson {
  const machine = createChatLoopMachine(DEFINITION_INTROSPECTION_SERVICES);
  const config = machine.config as {
    id?: string;
    initial?: string;
    states?: Record<string, Record<string, unknown>>;
  };

  return {
    format: 'workflow/v1',
    id: typeof config.id === 'string' ? config.id : 'chat-full-loop',
    initial: typeof config.initial === 'string' ? config.initial : 'preturn',
    states: serializeMachineStates(config.states),
  };
}

export function getChatLoopWorkflowDefinitionYaml(): string {
  return workflowDefinitionJsonToYaml(getChatLoopWorkflowDefinitionJson());
}

export function createChatLoopMachine(
  services: ChatLoopWorkflowServices,
  options?: ChatLoopMachineOptions
) {
  const runToolRoundAsync = resolveToolRoundService(services, options);

  const workflowSetup = setup({
    types: {
      input: {} as ChatLoopWorkflowInput,
      context: {} as ChatLoopMachineContext,
      output: {} as ChatLoopWorkflowOutput,
    },
    actors: {
      runPreturnInterceptors: fromPromise<ChatPreturnResult, { message: string }>(
        async ({ input }) =>
          parseChatPreturnResult(await services.runPreturnInterceptorsAsync(input))
      ),
      runSendTurn: fromPromise<ChatSendTurnResult, { message: string; hop: number }>(
        async ({ input }) => parseChatSendTurnResult(await services.runSendTurnAsync(input))
      ),
      runToolRound: fromPromise<
        ChatToolRoundResult,
        { pendingToolCall?: ChatToolCall; hop: number; lastText: string }
      >(async ({ input }) => {
        if (!input.pendingToolCall) {
          return {
            outcome: 'tool_failed',
            error: 'Tool round requested without a pending tool call.',
          };
        }

        return parseChatToolRoundResult(
          await runToolRoundAsync({
            toolCall: input.pendingToolCall,
            hop: input.hop,
            lastText: input.lastText,
          })
        );
      }),
      runPostTurnResolution: fromPromise<
        ChatPostTurnResolutionResult,
        { text: string; hop: number }
      >(async ({ input }) =>
        parseChatPostTurnResolutionResult(await services.runPostTurnResolutionAsync(input))
      ),
      runHandoffTransition: fromPromise<
        ChatHandoffTransitionResult,
        { handoff?: ChatPostTurnResolutionResult; hop: number }
      >(async ({ input }) => {
        if (input.handoff?.outcome !== 'handoff_required') {
          return {};
        }

        return parseChatHandoffTransitionResult(
          await services.runHandoffTransitionAsync({ handoff: input.handoff, hop: input.hop })
        );
      }),
      runFailure: fromPromise<void, { error?: string; hop: number; state: string }>(
        async ({ input }) => {
          await services.runFailureAsync?.({
            error: input.error ?? 'Unknown workflow failure',
            hop: input.hop,
            state: input.state,
          });
        }
      ),
    },
    guards: {
      preturnConsumed: ({ context }) => context.preturn?.outcome === 'consumed',
      preturnForwarded: ({ context }) => context.preturn?.outcome === 'forwarded',
      sendTurnNeedsToolRound: ({ context }) =>
        context.sendTurn?.toolRoundNeeded === true && !!context.pendingToolCall,
      toolRoundResumeLlm: ({ context }) => context.toolRound?.outcome === 'resume_llm',
      toolRoundFailed: ({ context }) => context.toolRound?.outcome === 'tool_failed',
      postTurnNormalComplete: ({ context }) => context.postTurn?.outcome === 'normal_complete',
      postTurnHandoffRequired: ({ context }) => context.postTurn?.outcome === 'handoff_required',
      postTurnHandoffMaxHopsReached: ({ context }) =>
        context.postTurn?.outcome === 'handoff_required' && context.hop >= context.maxHops,
    },
  });

  return workflowSetup.createMachine({
    id: 'chat-full-loop',
    initial: 'preturn',
    context: ({ input }) => ({
      currentMessage: input.message,
      maxHops: input.maxHops ?? DEFAULT_MAX_HOPS,
      hop: 0,
      autoReactMessage: input.autoReactMessage ?? DEFAULT_AUTO_REACT_MESSAGE,
      lastText: '',
    }),
    states: {
      preturn: {
        invoke: {
          src: 'runPreturnInterceptors',
          input: ({ context }) => ({ message: context.currentMessage }),
          onDone: {
            target: 'routeAfterPreturn',
            actions: assign({
              preturn: ({ event }) => event.output,
              lastText: ({ context, event }) => event.output.text ?? context.lastText,
            }),
          },
          onError: {
            target: 'failure',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'preturn failed'),
              failureState: () => 'preturn',
            }),
          },
        },
      },

      routeAfterPreturn: {
        always: [
          { guard: 'preturnConsumed', target: 'completed' },
          { guard: 'preturnForwarded', target: 'prepareForwardedAutoReact' },
          { target: 'sendTurn' },
        ],
      },

      prepareForwardedAutoReact: {
        entry: assign({
          currentMessage: ({ context }) => context.preturn?.autoMessage ?? context.autoReactMessage,
        }),
        always: { target: 'sendTurn' },
      },

      sendTurn: {
        invoke: {
          src: 'runSendTurn',
          input: ({ context }) => ({ message: context.currentMessage, hop: context.hop }),
          onDone: {
            target: 'routeAfterSendTurn',
            actions: assign({
              sendTurn: ({ event }) => event.output,
              lastText: ({ event }) => event.output.text,
              pendingToolCall: ({ event }) => event.output.pendingToolCall,
            }),
          },
          onError: {
            target: 'failure',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'sendTurn failed'),
              failureState: () => 'sendTurn',
            }),
          },
        },
      },

      routeAfterSendTurn: {
        always: [
          { guard: 'sendTurnNeedsToolRound', target: 'toolRound' },
          { target: 'postTurnResolution' },
        ],
      },

      toolRound: {
        invoke: {
          src: 'runToolRound',
          input: ({ context }) => ({
            pendingToolCall: context.pendingToolCall,
            hop: context.hop,
            lastText: context.lastText,
          }),
          onDone: {
            target: 'routeAfterToolRound',
            actions: assign({ toolRound: ({ event }) => event.output }),
          },
          onError: {
            target: 'failure',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'toolRound failed'),
              failureState: () => 'toolRound',
            }),
          },
        },
      },

      routeAfterToolRound: {
        always: [
          { guard: 'toolRoundResumeLlm', target: 'sendTurn' },
          {
            guard: 'toolRoundFailed',
            target: 'failure',
            actions: assign({
              errorMessage: ({ context }) => context.toolRound?.error ?? 'Tool round failed',
              failureState: () => 'toolRound',
            }),
          },
          { target: 'postTurnResolution' },
        ],
      },

      postTurnResolution: {
        invoke: {
          src: 'runPostTurnResolution',
          input: ({ context }) => ({ text: context.lastText, hop: context.hop }),
          onDone: {
            target: 'routeAfterPostTurn',
            actions: assign({ postTurn: ({ event }) => event.output }),
          },
          onError: {
            target: 'failure',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'postTurnResolution failed'),
              failureState: () => 'postTurnResolution',
            }),
          },
        },
      },

      routeAfterPostTurn: {
        always: [
          { guard: 'postTurnNormalComplete', target: 'completed' },
          { guard: 'postTurnHandoffMaxHopsReached', target: 'maxHopsReached' },
          { guard: 'postTurnHandoffRequired', target: 'handoffTransition' },
          { target: 'completed' },
        ],
      },

      handoffTransition: {
        invoke: {
          src: 'runHandoffTransition',
          input: ({ context }) => ({ handoff: context.postTurn, hop: context.hop }),
          onDone: {
            target: 'sendTurn',
            actions: assign({
              currentMessage: ({ context, event }) =>
                event.output.autoMessage ?? context.autoReactMessage,
              hop: ({ context }) => context.hop + 1,
            }),
          },
          onError: {
            target: 'failure',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'handoffTransition failed'),
              failureState: () => 'handoffTransition',
            }),
          },
        },
      },

      failure: {
        invoke: {
          src: 'runFailure',
          input: ({ context }) => ({
            error: context.errorMessage,
            hop: context.hop,
            state: context.failureState ?? 'unknown',
          }),
          onDone: { target: 'failed' },
          onError: { target: 'failed' },
        },
      },

      completed: {
        type: 'final',
        output: ({ context }) => ({
          status: 'completed',
          text: context.lastText,
          hopCount: context.hop,
        }),
      },

      maxHopsReached: {
        type: 'final',
        output: ({ context }) => ({
          status: 'max_hops_reached',
          text: context.lastText,
          hopCount: context.hop,
        }),
      },

      failed: {
        type: 'final',
        output: ({ context }) => ({
          status: 'failed',
          text: context.lastText,
          hopCount: context.hop,
          error: context.errorMessage ?? 'Workflow execution failed',
        }),
      },
    },
  });
}

export async function runChatLoopWorkflowAsync(
  input: ChatLoopWorkflowInput,
  services: ChatLoopWorkflowServices,
  options?: ChatLoopMachineOptions
): Promise<ChatLoopWorkflowOutput> {
  const actor = createActor(createChatLoopMachine(services, options), { input });
  actor.start();

  try {
    const output = await toPromise(actor);
    if (output) {
      return output;
    }

    const snapshot = actor.getSnapshot() as {
      value: unknown;
      context: ChatLoopMachineContext;
    };

    if (snapshot.value === 'completed') {
      return {
        status: 'completed',
        text: snapshot.context.lastText,
        hopCount: snapshot.context.hop,
      };
    }

    if (snapshot.value === 'maxHopsReached') {
      return {
        status: 'max_hops_reached',
        text: snapshot.context.lastText,
        hopCount: snapshot.context.hop,
      };
    }

    return {
      status: 'failed',
      text: snapshot.context.lastText,
      hopCount: snapshot.context.hop,
      error: snapshot.context.errorMessage ?? 'Workflow execution failed',
    };
  } finally {
    actor.stop();
  }
}
