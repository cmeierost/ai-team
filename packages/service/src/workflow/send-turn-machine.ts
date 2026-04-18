import { inspect } from 'node:util';
import type { ChatCompletionMessageParam, StructuredToolResult } from '@ai-team/infrastructure';
import type {
  WorkflowDefinitionDocument,
  WorkflowDefinitionState,
  WorkflowDefinitionTransition,
} from '@ai-team/api-client';
import { assign, createActor, fromPromise, setup, toPromise } from 'xstate';

import type { TurnResult } from '../orchestrator/pipeline.js';
import {
  ensureTurnStartAsync,
  finalizeTurnResultAsync,
  handleLlmFailureAsync,
  invokeTurnLlmAsync,
  parseTurnResultAsync,
  persistAssistantMessageAsync,
  persistUserMessageAsync,
  prepareMessagesAsync,
  resolveSkillsAndToolsAsync,
} from '../orchestrator/send-turn-steps.js';
import { parseChatSendTurnResult, type ChatSendTurnResult } from './chat-loop-contracts.js';
import {
  parseSendTurnMachineFailureOutput,
  parseSendTurnMachineInput,
  parseSendTurnMachineOutput,
  type SendTurnMachineContext,
  type SendTurnMachineFailureOutput,
  type SendTurnMachineOutput,
  type SendTurnMachineRuntimeInput,
} from './send-turn-contracts.js';
import { workflowDefinitionJsonToYaml } from './definition-format.js';

interface SendTurnMachineCompletedEvent {
  output: SendTurnMachineOutput;
}

interface SendTurnMachineFailedEvent {
  output: SendTurnMachineFailureOutput;
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

function toChatSendTurnResult(turnResult: TurnResult): ChatSendTurnResult {
  return parseChatSendTurnResult({
    text: turnResult.text,
    toolRoundNeeded: false,
  });
}

function isCompletedOutput(
  output: SendTurnMachineOutput | SendTurnMachineFailureOutput | undefined
): output is SendTurnMachineOutput {
  return !!output && 'chatResult' in output;
}

export type SendTurnWorkflowDefinitionJson = WorkflowDefinitionDocument;
export type SendTurnWorkflowTransitionJson = WorkflowDefinitionTransition;
export type SendTurnWorkflowStateJson = WorkflowDefinitionState;

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
  target: SendTurnWorkflowTransitionJson[],
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
): SendTurnWorkflowTransitionJson[] {
  const transitions: SendTurnWorkflowTransitionJson[] = [];

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

function serializeStateConfig(stateConfig: Record<string, unknown>): SendTurnWorkflowStateJson {
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
): Record<string, SendTurnWorkflowStateJson> {
  const states: Record<string, SendTurnWorkflowStateJson> = {};
  for (const [stateId, stateConfig] of Object.entries(configStates ?? {})) {
    states[stateId] = serializeStateConfig(stateConfig);
  }
  return states;
}

export function getSendTurnWorkflowDefinitionJson(): SendTurnWorkflowDefinitionJson {
  const machine = createSendTurnMachine();
  const config = machine.config as {
    initial?: string;
    states?: Record<string, Record<string, unknown>>;
  };

  return {
    format: 'workflow/v1',
    id: 'chat-send-turn',
    initial: typeof config.initial === 'string' ? config.initial : 'ensureTurnStart',
    states: serializeMachineStates(config.states),
  };
}

export function getSendTurnWorkflowDefinitionYaml(): string {
  return workflowDefinitionJsonToYaml(getSendTurnWorkflowDefinitionJson());
}

export function createSendTurnMachine() {
  const machineSetup = setup({
    types: {
      input: {} as SendTurnMachineRuntimeInput,
      context: {} as SendTurnMachineContext,
      output: {} as SendTurnMachineOutput | SendTurnMachineFailureOutput,
    },
    actors: {
      ensureTurnStart: fromPromise<
        void,
        Pick<SendTurnMachineContext, 'userMessage' | 'plugins' | 'ctx' | 'options'>
      >(async ({ input }) => {
        await ensureTurnStartAsync(input.userMessage, input.plugins, input.ctx, input.options);
      }),
      persistUserMessage: fromPromise<
        void,
        Pick<SendTurnMachineContext, 'userMessage' | 'ctx' | 'options'>
      >(async ({ input }) => {
        await persistUserMessageAsync(input.userMessage, input.ctx, input.options);
      }),
      prepareMessages: fromPromise<
        ChatCompletionMessageParam[],
        Pick<SendTurnMachineContext, 'userMessage' | 'plugins' | 'ctx'>
      >(async ({ input }) => prepareMessagesAsync(input.userMessage, input.plugins, input.ctx)),
      resolveSkillsTools: fromPromise<
        NonNullable<SendTurnMachineContext['resolved']>,
        Pick<SendTurnMachineContext, 'userMessage' | 'plugins' | 'ctx'>
      >(async ({ input }) =>
        resolveSkillsAndToolsAsync(input.userMessage, input.plugins, input.ctx)
      ),
      invokeLlm: fromPromise<
        { fullResponse: string; structuredResults: StructuredToolResult[] },
        Pick<SendTurnMachineContext, 'messages' | 'resolved' | 'ctx'>
      >(async ({ input }) => {
        const resolved = input.resolved;
        if (!resolved) {
          throw new Error('invokeLlm requires resolved skills/tools state.');
        }

        return invokeTurnLlmAsync(input.messages, resolved, input.ctx);
      }),
      handleLlmFailure: fromPromise<
        TurnResult,
        Pick<
          SendTurnMachineContext,
          'invocationError' | 'plugins' | 'ctx' | 'options' | 'structuredResults'
        >
      >(async ({ input }) => {
        if (!input.invocationError) {
          throw new Error('llmFailure state requires invocationError.');
        }

        return handleLlmFailureAsync(
          input.invocationError,
          input.plugins,
          input.ctx,
          input.options,
          input.structuredResults
        );
      }),
      persistAssistantMessage: fromPromise<
        { persistedContent: string },
        Pick<SendTurnMachineContext, 'fullResponse' | 'plugins' | 'ctx'>
      >(async ({ input }) => {
        const persisted = await persistAssistantMessageAsync(
          input.fullResponse,
          input.plugins,
          input.ctx
        );
        return { persistedContent: persisted.persistedContent };
      }),
      parseResult: fromPromise<
        TurnResult | null,
        Pick<
          SendTurnMachineContext,
          'structuredResults' | 'fullResponse' | 'persistedContent' | 'plugins' | 'ctx'
        >
      >(async ({ input }) =>
        parseTurnResultAsync(
          input.structuredResults,
          input.fullResponse,
          input.persistedContent,
          input.plugins,
          input.ctx
        )
      ),
      finalizeResult: fromPromise<
        TurnResult,
        Pick<
          SendTurnMachineContext,
          | 'parsedTurnResult'
          | 'persistedContent'
          | 'fullResponse'
          | 'structuredResults'
          | 'plugins'
          | 'ctx'
        >
      >(async ({ input }) => {
        const turnResult: TurnResult = input.parsedTurnResult ?? {
          text: input.persistedContent,
          done: false,
        };

        return finalizeTurnResultAsync(
          turnResult,
          input.fullResponse,
          input.persistedContent,
          input.structuredResults,
          input.plugins,
          input.ctx
        );
      }),
    },
  });

  return machineSetup.createMachine({
    id: 'chat-send-turn',
    initial: 'ensureTurnStart',
    context: ({ input }) => {
      const normalizedInput = parseSendTurnMachineInput({
        userMessage: input.userMessage,
        hop: input.hop,
        options: input.options,
      });

      return {
        userMessage: normalizedInput.userMessage,
        hop: normalizedInput.hop,
        options: normalizedInput.options,
        ctx: input.ctx,
        plugins: input.plugins,
        messages: [],
        resolved: undefined,
        fullResponse: '',
        structuredResults: [],
        persistedContent: '',
        parsedTurnResult: null,
        finalTurnResult: null,
        invocationError: undefined,
        errorMessage: undefined,
        failureStep: undefined,
      };
    },
    states: {
      ensureTurnStart: {
        invoke: {
          src: 'ensureTurnStart',
          input: ({ context }) => ({
            userMessage: context.userMessage,
            plugins: context.plugins,
            ctx: context.ctx,
            options: context.options,
          }),
          onDone: { target: 'persistUserMessage' },
          onError: {
            target: 'failed',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'ensureTurnStart failed'),
              failureStep: () => 'ensureTurnStart',
            }),
          },
        },
      },

      persistUserMessage: {
        invoke: {
          src: 'persistUserMessage',
          input: ({ context }) => ({
            userMessage: context.userMessage,
            ctx: context.ctx,
            options: context.options,
          }),
          onDone: { target: 'prepareMessages' },
          onError: {
            target: 'failed',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'persistUserMessage failed'),
              failureStep: () => 'persistUserMessage',
            }),
          },
        },
      },

      prepareMessages: {
        invoke: {
          src: 'prepareMessages',
          input: ({ context }) => ({
            userMessage: context.userMessage,
            plugins: context.plugins,
            ctx: context.ctx,
          }),
          onDone: {
            target: 'resolveSkillsTools',
            actions: assign({
              messages: ({ event }) => event.output,
            }),
          },
          onError: {
            target: 'failed',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'prepareMessages failed'),
              failureStep: () => 'prepareMessages',
            }),
          },
        },
      },

      resolveSkillsTools: {
        invoke: {
          src: 'resolveSkillsTools',
          input: ({ context }) => ({
            userMessage: context.userMessage,
            plugins: context.plugins,
            ctx: context.ctx,
          }),
          onDone: {
            target: 'invokeLlm',
            actions: assign({
              resolved: ({ event }) => event.output,
            }),
          },
          onError: {
            target: 'failed',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'resolveSkillsTools failed'),
              failureStep: () => 'resolveSkillsTools',
            }),
          },
        },
      },

      invokeLlm: {
        invoke: {
          src: 'invokeLlm',
          input: ({ context }) => ({
            messages: context.messages,
            resolved: context.resolved,
            ctx: context.ctx,
          }),
          onDone: {
            target: 'persistAssistantMessage',
            actions: [
              assign({
                fullResponse: ({ event }) => event.output.fullResponse,
                structuredResults: ({ event }) => event.output.structuredResults,
              }),
              () => {
                process.stdout.write('\n');
              },
            ],
          },
          onError: {
            target: 'llmFailure',
            actions: assign({
              invocationError: ({ event }) => (event as { error?: unknown }).error,
              failureStep: () => 'invokeLlm',
            }),
          },
        },
      },

      llmFailure: {
        invoke: {
          src: 'handleLlmFailure',
          input: ({ context }) => ({
            invocationError: context.invocationError,
            plugins: context.plugins,
            ctx: context.ctx,
            options: context.options,
            structuredResults: context.structuredResults,
          }),
          onDone: {
            target: 'completed',
            actions: assign({
              finalTurnResult: ({ event }) => event.output,
            }),
          },
          onError: {
            target: 'failed',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'llmFailure failed'),
              failureStep: () => 'llmFailure',
            }),
          },
        },
      },

      persistAssistantMessage: {
        invoke: {
          src: 'persistAssistantMessage',
          input: ({ context }) => ({
            fullResponse: context.fullResponse,
            plugins: context.plugins,
            ctx: context.ctx,
          }),
          onDone: {
            target: 'parseResult',
            actions: assign({
              persistedContent: ({ event }) => event.output.persistedContent,
            }),
          },
          onError: {
            target: 'failed',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage(
                  (event as { error?: unknown }).error ?? 'persistAssistantMessage failed'
                ),
              failureStep: () => 'persistAssistantMessage',
            }),
          },
        },
      },

      parseResult: {
        invoke: {
          src: 'parseResult',
          input: ({ context }) => ({
            structuredResults: context.structuredResults,
            fullResponse: context.fullResponse,
            persistedContent: context.persistedContent,
            plugins: context.plugins,
            ctx: context.ctx,
          }),
          onDone: {
            target: 'finalizeResult',
            actions: assign({
              parsedTurnResult: ({ event }) => event.output,
            }),
          },
          onError: {
            target: 'failed',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'parseResult failed'),
              failureStep: () => 'parseResult',
            }),
          },
        },
      },

      finalizeResult: {
        invoke: {
          src: 'finalizeResult',
          input: ({ context }) => ({
            parsedTurnResult: context.parsedTurnResult,
            persistedContent: context.persistedContent,
            fullResponse: context.fullResponse,
            structuredResults: context.structuredResults,
            plugins: context.plugins,
            ctx: context.ctx,
          }),
          onDone: {
            target: 'completed',
            actions: assign({
              finalTurnResult: ({ event }) => event.output,
            }),
          },
          onError: {
            target: 'failed',
            actions: assign({
              errorMessage: ({ event }) =>
                toErrorMessage((event as { error?: unknown }).error ?? 'finalizeResult failed'),
              failureStep: () => 'finalizeResult',
            }),
          },
        },
      },

      completed: {
        type: 'final',
        output: ({ context }) => {
          const finalTurnResult = context.finalTurnResult ?? {
            text: context.persistedContent || context.fullResponse,
            done: false,
          };

          return parseSendTurnMachineOutput({
            chatResult: toChatSendTurnResult(finalTurnResult),
            turnResult: finalTurnResult,
          });
        },
      },

      failed: {
        type: 'final',
        output: ({ context }) =>
          parseSendTurnMachineFailureOutput({
            error: context.errorMessage ?? 'Send-turn state machine failed.',
            failedStep: context.failureStep,
          }),
      },
    },
  });
}

export async function runSendTurnMachineAsync(
  input: SendTurnMachineRuntimeInput
): Promise<SendTurnMachineOutput> {
  const actor = createActor(createSendTurnMachine(), { input });
  actor.start();

  try {
    const output = await toPromise(actor);

    if (isCompletedOutput(output)) {
      return output;
    }

    const snapshot = actor.getSnapshot() as {
      value: unknown;
      output?: SendTurnMachineOutput | SendTurnMachineFailureOutput;
      context: SendTurnMachineContext;
    };

    if (isCompletedOutput(snapshot.output)) {
      return snapshot.output;
    }

    if (snapshot.value === 'completed') {
      const fallbackTurnResult = snapshot.context.finalTurnResult ?? {
        text: snapshot.context.persistedContent || snapshot.context.fullResponse,
        done: false,
      };

      return parseSendTurnMachineOutput({
        chatResult: toChatSendTurnResult(fallbackTurnResult),
        turnResult: fallbackTurnResult,
      });
    }

    const failureOutput =
      snapshot.output && !isCompletedOutput(snapshot.output)
        ? snapshot.output
        : parseSendTurnMachineFailureOutput({
            error: snapshot.context.errorMessage ?? 'Send-turn state machine failed.',
            failedStep: snapshot.context.failureStep,
          });

    throw new Error(
      failureOutput.failedStep
        ? `[send-turn:${failureOutput.failedStep}] ${failureOutput.error}`
        : `[send-turn] ${failureOutput.error}`
    );
  } finally {
    actor.stop();
  }
}

export type { SendTurnMachineOutput } from './send-turn-contracts.js';
