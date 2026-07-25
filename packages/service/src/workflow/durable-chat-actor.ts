import { assign, fromPromise, setup, type AnyActorLogic } from 'xstate';

export interface DurableChatActorInput {
  sessionId: string;
  systemPrompt: string;
  toolAllowlist: string[];
}

export interface DurableChatTurnResult {
  assistantMessage?: string;
}

export interface DurableChatCompletionResult {
  done: boolean;
  feedback?: string;
}

export interface DurableChatActorServices<TOutput> {
  processTurn(input: DurableChatActorInput & { message: string }): Promise<DurableChatTurnResult>;
  checkCompletion(input: DurableChatActorInput): Promise<DurableChatCompletionResult>;
  finalize(input: DurableChatActorInput): Promise<TOutput>;
}

export interface DurableChatActorContext extends DurableChatActorInput {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  pendingMessage?: string;
  feedback?: string;
  output?: unknown;
}

export type DurableChatActorEvent =
  | { type: 'CHAT_TURN'; message: string }
  | { type: 'RETURN_ATTEMPT' };

/**
 * Durable child-machine primitive for multi-request chat. All prompt and tool
 * policy data is actor input/context; later requests only send typed events.
 */
export function createDurableChatActor<TOutput>(
  services: DurableChatActorServices<TOutput>
): AnyActorLogic {
  return setup({
    types: {
      context: {} as DurableChatActorContext,
      input: {} as DurableChatActorInput,
      events: {} as DurableChatActorEvent,
    },
    actors: {
      processTurn: fromPromise(async ({ input }: { input: DurableChatActorInput & { message: string } }) =>
        services.processTurn(input)
      ),
      checkCompletion: fromPromise(async ({ input }: { input: DurableChatActorInput }) =>
        services.checkCompletion(input)
      ),
      finalize: fromPromise(async ({ input }: { input: DurableChatActorInput }) =>
        services.finalize(input)
      ),
    },
    guards: {
      completionAccepted: ({ event }) =>
        (event as unknown as { output: DurableChatCompletionResult }).output.done,
    },
  }).createMachine({
    id: 'durable-chat',
    initial: 'conversing',
    context: ({ input }) => ({ ...input, messages: [] }),
    output: ({ context }) => context.output,
    states: {
      conversing: {
        on: {
          CHAT_TURN: {
            target: 'processingTurn',
            actions: assign({ pendingMessage: ({ event }) => event.message }),
          },
          RETURN_ATTEMPT: 'checkingCompletion',
        },
      },
      processingTurn: {
        invoke: {
          src: 'processTurn',
          input: ({ context }) => ({
            ...context,
            message: context.pendingMessage ?? '',
          }),
          onDone: {
            target: 'conversing',
            actions: assign(({ context, event }) => {
              const message = (event.output as DurableChatTurnResult).assistantMessage;
              return {
                messages: [
                  ...context.messages,
                  { role: 'user' as const, content: context.pendingMessage ?? '' },
                  ...(message ? [{ role: 'assistant' as const, content: message }] : []),
                ],
                pendingMessage: undefined,
              };
            }),
          },
        },
      },
      checkingCompletion: {
        invoke: {
          src: 'checkCompletion',
          input: ({ context }) => ({ ...context }),
          onDone: [
            { guard: 'completionAccepted', target: 'finalizing' },
            {
              target: 'conversing',
              actions: assign({
                feedback: ({ event }) => (event.output as DurableChatCompletionResult).feedback,
              }),
            },
          ],
        },
      },
      finalizing: {
        invoke: {
          src: 'finalize',
          input: ({ context }) => ({ ...context }),
          onDone: {
            target: 'complete',
            actions: assign({ output: ({ event }) => event.output }),
          },
        },
      },
      complete: { type: 'final' },
    },
  });
}
