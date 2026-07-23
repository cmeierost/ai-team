import type { ExecutionContext, ICommandDispatcher, IWorkflowRunnerFactory } from '@ai-team/core';
import {
  ChatRuntime,
  createChatRuntimeStepCommand,
  type ChatRuntimeRunInput,
  type ChatRuntimeStepName,
  type ChatRuntimeStepResolver,
  type ChatRuntimeTurnInput,
} from './chat-runtime.js';

interface SuccessfulHandoffTransition {
  targetAgentId?: string;
  targetSessionId?: string;
}
interface HandoffTransitionResponse {
  status: string;
  message?: string;
  data?: unknown;
}

/**
 * Service-owned command bridge for the XState chat runtime.
 *
 * Adapters provide only invocation provenance and render emitted events. All
 * send-turn and handoff orchestration remains in the shared service layer.
 */
export class CommandChatRuntime {
  constructor(
    private readonly commandDispatcher: ICommandDispatcher,
    private readonly workflowRunnerFactory: IWorkflowRunnerFactory
  ) {}

  async runAsync(input: ChatRuntimeRunInput) {
    const resolveStep = ((step: ChatRuntimeStepName) => {
      switch (step) {
        case 'preturn':
          return createChatRuntimeStepCommand('preturn', async () => ({
            outcome: 'continue' as const,
          }));
        case 'sendTurn':
          return createChatRuntimeStepCommand(
            'sendTurn',
            async (turnInput: ChatRuntimeTurnInput) => {
              const response = await this.commandDispatcher.dispatch(
                'chat-chat-direct-turn',
                {
                  agentId: turnInput.agentId,
                  options: {
                    message: turnInput.userMessage,
                    messageOrigin: turnInput.options.messageOrigin,
                    sessionId: turnInput.sessionId,
                    createNewSession: turnInput.createNewSession,
                  },
                },
                this.createExecutionContext(input, {
                  agentId: turnInput.agentId,
                  sessionId: turnInput.sessionId,
                  calledByHuman: turnInput.options.messageOrigin === 'developer',
                })
              );

              if (response.status !== 'ok') {
                throw new Error(response.message || 'chat turn dispatch failed');
              }

              const payload =
                response.data && typeof response.data === 'object'
                  ? (response.data as {
                      text?: string;
                      followUpMessage?: string;
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
                    })
                  : undefined;

              return {
                text: typeof response.data === 'string' ? response.data : (payload?.text ?? ''),
                toolRoundNeeded: false,
                ...payload,
              };
            }
          );
        case 'postTurnResolution':
          return createChatRuntimeStepCommand(
            'postTurnResolution',
            async (resolutionInput: {
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
            }) =>
              resolutionInput.handoffTargetId
                ? {
                    outcome: 'handoff_required' as const,
                    ...resolutionInput,
                  }
                : { outcome: 'normal_complete' as const }
          );
        case 'handoffTransition':
          return createChatRuntimeStepCommand(
            'handoffTransition',
            async (handoffInput: {
              handoff: {
                outcome: 'normal_complete' | 'handoff_required';
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
              };
              fromAgentId?: string;
              fromSessionId?: string;
            }) => {
              if (handoffInput.handoff.outcome !== 'handoff_required') return {};
              const targetAgentId = handoffInput.handoff.handoffTargetId;
              if (!targetAgentId) {
                throw new Error('Handoff transition requested without handoffTargetId.');
              }
              const response = await this.commandDispatcher.dispatch(
                'com-handoff',
                {
                  targetAgentId,
                  targetWorkflowId: handoffInput.handoff.handoffTargetWorkflowId ?? 'chat',
                  briefingNote: handoffInput.handoff.handoffNote,
                  workflowToolPolicy: handoffInput.handoff.handoffWorkflowToolPolicy,
                },
                this.createExecutionContext(input, {
                  agentId: handoffInput.fromAgentId,
                  sessionId: handoffInput.fromSessionId,
                })
              );
              const transition = this.requireSuccessfulHandoffTransition(response);
              return {
                agentId: transition.targetAgentId ?? targetAgentId,
                sessionId:
                  transition.targetSessionId ?? handoffInput.handoff.handoffTargetSessionId,
              };
            }
          );
        case 'toolRound':
        case 'failure':
          return undefined;
      }
    }) as ChatRuntimeStepResolver;

    return new ChatRuntime(resolveStep, this.workflowRunnerFactory.create()).runAsync(input);
  }

  private createExecutionContext(
    input: ChatRuntimeRunInput,
    values: {
      agentId?: string;
      sessionId?: string;
      calledByHuman?: boolean;
    }
  ): ExecutionContext {
    return {
      history: [],
      agentId: values.agentId,
      sessionId: values.sessionId,
      invocationSurface: input.invocationSurface,
      calledByHuman: values.calledByHuman ?? input.calledByHuman,
      callerType: (values.calledByHuman ?? input.calledByHuman) ? 'human' : input.callerType,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.subworkflowDepth !== undefined ? { subworkflowDepth: input.subworkflowDepth } : {}),
    };
  }

  private requireSuccessfulHandoffTransition(
    response: HandoffTransitionResponse
  ): SuccessfulHandoffTransition {
    if (response.status !== 'ok') {
      throw new Error(response.message || 'handoff transition failed');
    }
    if (!response.data || typeof response.data !== 'object') return {};
    const data = response.data as Record<string, unknown>;
    return {
      ...(typeof data['targetAgentId'] === 'string'
        ? { targetAgentId: data['targetAgentId'] }
        : {}),
      ...(typeof data['targetSessionId'] === 'string'
        ? { targetSessionId: data['targetSessionId'] }
        : {}),
    };
  }
}
