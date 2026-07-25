import type { ExecutionContext } from '@ai-team/core';
import type { AnyActorLogic } from 'xstate';
import type { DurableChatActorInput, DurableChatActorServices } from './durable-chat-actor.js';
import { createDurableChatActor } from './durable-chat-actor.js';
import { resolveWorkflowChatDefinition } from './workflow-chat-definition.js';
import type { WorkflowChatStep } from './workflow-types.js';

export interface WorkflowChatCommandInvoker {
  invoke(
    command: string,
    args: Record<string, unknown> | undefined,
    executionContext?: ExecutionContext,
    kind?: 'check' | 'finalize'
  ): Promise<unknown>;
}

/** Serializable command details supplied by the parent at child invocation time. */
export interface WorkflowChatActorInput extends DurableChatActorInput {
  done: { command: string; args?: Record<string, unknown> };
  finalize: { command: string; args?: Record<string, unknown> };
  executionContext?: ExecutionContext;
}

/**
 * Creates the reusable child actor source used by compiled parent workflow
 * states. The parent supplies resolved, serializable command details as input.
 */
export function createWorkflowChatActor(
  services: Pick<DurableChatActorServices<unknown>, 'processTurn'> & WorkflowChatCommandInvoker
): AnyActorLogic {
  return createDurableChatActor({
    processTurn: services.processTurn,
    checkCompletion: async (input) => {
      const chatInput = input as WorkflowChatActorInput;
      return (await services.invoke(
        chatInput.done.command,
        chatInput.done.args,
        chatInput.executionContext,
        'check'
      )) as { done: boolean; feedback?: string };
    },
    finalize: async (input) => {
      const chatInput = input as WorkflowChatActorInput;
      return services.invoke(
        chatInput.finalize.command,
        chatInput.finalize.args,
        chatInput.executionContext,
        'finalize'
      );
    },
  });
}

/** Compiles a serializable chat step into the reusable invoked child actor. */
export function compileWorkflowChatStep<TState>(
  step: WorkflowChatStep<TState>,
  state: TState,
  services: Pick<DurableChatActorServices<unknown>, 'processTurn'> & WorkflowChatCommandInvoker
) {
  const resolved = resolveWorkflowChatDefinition(step, state);
  return createDurableChatActor({
    processTurn: services.processTurn,
    checkCompletion: async () => {
      const result = await services.invoke(resolved.done.command, resolved.done.args);
      return result as { done: boolean; feedback?: string };
    },
    finalize: async () => services.invoke(resolved.finalize.command, resolved.finalize.args),
  });
}
