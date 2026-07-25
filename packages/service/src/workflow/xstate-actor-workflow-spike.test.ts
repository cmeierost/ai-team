import { describe, expect, it, vi } from 'vitest';
import {
  assign,
  createActor,
  fromCallback,
  fromPromise,
  sendParent,
  sendTo,
  setup,
  spawnChild,
  waitFor,
} from 'xstate';

const parentRunId = 'run-onboarding-1';
const businessActorPath = 'onboarding.business-chat';
const businessIdempotencyKey = `${parentRunId}:${businessActorPath}:return:1`;

function createBusinessChatMachine(checks: Array<{ done: boolean; feedback?: string }>) {
  return setup({
    types: {
      context: {} as {
        sessionId: string;
        idempotencyKey: string;
        feedback?: string;
      },
      input: {} as { sessionId: string; idempotencyKey: string },
      events: {} as { type: 'RETURN_ATTEMPT' },
    },
    actors: {
      checkCompletion: fromPromise(async () => checks.shift() ?? { done: true }),
      finalize: fromPromise(async () => ({ businessDefinition: 'approved-business' })),
    },
    guards: {
      completionAccepted: ({ event }) => event.output.done,
    },
  }).createMachine({
    id: 'business-chat',
    initial: 'waiting',
    context: ({ input }) => ({
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
    }),
    output: ({ context }) => ({
      businessDefinition: 'approved-business',
      sessionId: context.sessionId,
      idempotencyKey: context.idempotencyKey,
    }),
    states: {
      waiting: {
        on: { RETURN_ATTEMPT: 'checkingCompletion' },
      },
      checkingCompletion: {
        invoke: {
          src: 'checkCompletion',
          onDone: [
            {
              guard: 'completionAccepted',
              target: 'finalizing',
            },
            {
              target: 'waiting',
              actions: assign({ feedback: ({ event }) => event.output.feedback }),
            },
          ],
        },
      },
      finalizing: {
        invoke: {
          src: 'finalize',
          onDone: 'complete',
        },
      },
      complete: { type: 'final' },
    },
  });
}

function createOnboardingMachine(checks: Array<{ done: boolean; feedback?: string }>) {
  const businessChat = createBusinessChatMachine(checks);

  return setup({
    types: {
      context: {} as {
        runId: string;
        businessDefinition?: string;
        childSessionId?: string;
        childIdempotencyKey?: string;
      },
      input: {} as { runId: string },
      events: {} as { type: 'RETURN_ATTEMPT' },
    },
    actors: {
      businessChat,
    },
  }).createMachine({
    id: 'onboarding',
    initial: 'definingBusiness',
    context: ({ input }) => ({ runId: input.runId }),
    states: {
      definingBusiness: {
        invoke: {
          id: businessActorPath,
          src: 'businessChat',
          input: ({ context }) => ({
            sessionId: 'session-ceo-1',
            idempotencyKey: `${context.runId}:${businessActorPath}:return:1`,
          }),
          onDone: {
            target: 'selectingHr',
            actions: assign({
              businessDefinition: ({ event }) => event.output.businessDefinition,
              childSessionId: ({ event }) => event.output.sessionId,
              childIdempotencyKey: ({ event }) => event.output.idempotencyKey,
            }),
          },
        },
        on: {
          RETURN_ATTEMPT: {
            actions: sendTo(businessActorPath, ({ event }) => event),
          },
        },
      },
      selectingHr: { type: 'final' },
    },
  });
}

describe('XState workflow actor spike', () => {
  it('restores an invoked child after a rejected return and returns typed output to its parent', async () => {
    const machine = createOnboardingMachine([
      { done: false, feedback: 'Approve business.md first.' },
      { done: true },
    ]);
    const original = createActor(machine, { input: { runId: parentRunId } }).start();

    original.send({ type: 'RETURN_ATTEMPT' });
    const originalChild = original.getSnapshot().children[businessActorPath];
    await waitFor(
      originalChild!,
      (snapshot) =>
        snapshot.value === 'waiting' && snapshot.context.feedback === 'Approve business.md first.'
    );

    const persisted = JSON.parse(JSON.stringify(original.getPersistedSnapshot()));
    original.stop();

    const restored = createActor(machine, { snapshot: persisted }).start();
    const restoredChild = restored.getSnapshot().children[businessActorPath];

    expect(restoredChild?.getSnapshot().value).toBe('waiting');
    expect(restoredChild?.getSnapshot().context).toMatchObject({
      sessionId: 'session-ceo-1',
      idempotencyKey: businessIdempotencyKey,
      feedback: 'Approve business.md first.',
    });

    restored.send({ type: 'RETURN_ATTEMPT' });
    await waitFor(restored, (snapshot) => snapshot.status === 'done');

    expect(restored.getSnapshot().context).toEqual({
      runId: parentRunId,
      businessDefinition: 'approved-business',
      childSessionId: 'session-ceo-1',
      childIdempotencyKey: businessIdempotencyKey,
    });
  });

  it('stops an invoked child when its parent is cancelled', () => {
    const childStopped = vi.fn();
    const child = setup({
      actors: {
        waitForCancellation: fromCallback(() => childStopped),
      },
    }).createMachine({
      initial: 'waiting',
      states: {
        waiting: { invoke: { src: 'waitForCancellation' } },
      },
    });
    const parent = setup({ actors: { child } }).createMachine({
      initial: 'running',
      states: {
        running: { invoke: { id: 'child', src: 'child' } },
      },
    });

    const actor = createActor(parent).start();
    actor.stop();

    expect(childStopped).toHaveBeenCalledOnce();
  });

  it('restores a known workflow tool while waiting and appends one correlated result', async () => {
    const knownWorkflow = setup({
      types: {
        context: {} as { toolCallId: string; answer?: string },
        input: {} as { toolCallId: string },
        events: {} as { type: 'ANSWER_SUBMITTED'; answer: string },
      },
    }).createMachine({
      id: 'known-workflow',
      initial: 'waitingForAnswer',
      context: ({ input }) => ({ toolCallId: input.toolCallId }),
      output: ({ context }) => ({
        toolCallId: context.toolCallId,
        data: { answer: context.answer },
      }),
      states: {
        waitingForAnswer: {
          on: {
            ANSWER_SUBMITTED: {
              target: 'complete',
              actions: assign({ answer: ({ event }) => event.answer }),
            },
          },
        },
        complete: { type: 'final' },
      },
    });
    const chat = setup({
      types: {
        context: {} as { toolResults: Array<{ toolCallId: string; data: unknown }> },
        events: {} as
          | { type: 'WORKFLOW_TOOL_SELECTED'; toolCallId: string }
          | { type: 'ANSWER_SUBMITTED'; answer: string },
      },
      actors: { knownWorkflow },
    }).createMachine({
      id: 'chat',
      initial: 'waitingForTool',
      context: { toolResults: [] },
      states: {
        waitingForTool: {
          on: {
            WORKFLOW_TOOL_SELECTED: 'runningKnownWorkflow',
          },
        },
        runningKnownWorkflow: {
          invoke: {
            id: 'tool:hr_hire',
            src: 'knownWorkflow',
            input: ({ event }) => ({ toolCallId: event.toolCallId }),
            onDone: {
              target: 'waitingForTool',
              actions: assign({
                toolResults: ({ context, event }) => [...context.toolResults, event.output],
              }),
            },
          },
          on: {
            ANSWER_SUBMITTED: {
              actions: sendTo('tool:hr_hire', ({ event }) => event),
            },
          },
        },
      },
    });
    const original = createActor(chat).start();

    original.send({ type: 'WORKFLOW_TOOL_SELECTED', toolCallId: 'tool-call-7' });
    await waitFor(
      original,
      (snapshot) => snapshot.children['tool:hr_hire']?.getSnapshot().value === 'waitingForAnswer'
    );
    const persisted = JSON.parse(JSON.stringify(original.getPersistedSnapshot()));
    original.stop();

    const restored = createActor(chat, { snapshot: persisted }).start();
    restored.send({ type: 'ANSWER_SUBMITTED', answer: 'hire the Head of Development' });
    await waitFor(
      restored,
      (snapshot) => snapshot.value === 'waitingForTool' && snapshot.context.toolResults.length === 1
    );

    expect(restored.getSnapshot().context.toolResults).toEqual([
      {
        toolCallId: 'tool-call-7',
        data: { answer: 'hire the Head of Development' },
      },
    ]);
  });

  it('requires explicit correlation messages when a workflow child is dynamically spawned', async () => {
    const child = setup({
      types: {
        context: {} as { toolCallId: string },
        input: {} as { toolCallId: string },
        events: {} as { type: 'ANSWER_SUBMITTED'; answer: string },
      },
    }).createMachine({
      id: 'dynamic-workflow',
      initial: 'waiting',
      context: ({ input }) => ({ toolCallId: input.toolCallId }),
      states: {
        waiting: {
          on: {
            ANSWER_SUBMITTED: {
              target: 'complete',
              actions: sendParent(({ context }) => ({
                type: 'DYNAMIC_CHILD_DONE',
                toolCallId: context.toolCallId,
              })),
            },
          },
        },
        complete: { type: 'final' },
      },
    });
    const parent = setup({
      types: {
        context: {} as { toolResults: string[] },
        events: {} as
          | { type: 'START_DYNAMIC_WORKFLOW'; toolCallId: string }
          | { type: 'ANSWER_SUBMITTED'; answer: string }
          | { type: 'DYNAMIC_CHILD_DONE'; toolCallId: string },
      },
      actors: { child },
    }).createMachine({
      initial: 'waiting',
      context: { toolResults: [] },
      states: {
        waiting: {
          on: {
            START_DYNAMIC_WORKFLOW: {
              target: 'running',
              actions: spawnChild('child', {
                id: 'dynamic-workflow-child',
                input: ({ event }) => ({ toolCallId: event.toolCallId }),
              }),
            },
          },
        },
        running: {
          on: {
            ANSWER_SUBMITTED: {
              actions: sendTo('dynamic-workflow-child', ({ event }) => event),
            },
            DYNAMIC_CHILD_DONE: {
              target: 'waiting',
              actions: assign({
                toolResults: ({ context, event }) => [...context.toolResults, event.toolCallId],
              }),
            },
          },
        },
      },
    });
    const actor = createActor(parent).start();

    actor.send({ type: 'START_DYNAMIC_WORKFLOW', toolCallId: 'tool-call-dynamic-1' });
    actor.send({ type: 'ANSWER_SUBMITTED', answer: 'continue' });
    await waitFor(
      actor,
      (snapshot) => snapshot.value === 'waiting' && snapshot.context.toolResults.length === 1
    );

    expect(actor.getSnapshot().context.toolResults).toEqual(['tool-call-dynamic-1']);
  });
});
