import { describe, expect, it } from 'vitest';
import { assign, sendTo, setup } from 'xstate';
import type { IWorkflowRunRepository, WorkflowRunRecord } from '@ai-team/core';
import { createDurableChatActor } from './durable-chat-actor.js';
import { WorkflowActorHost } from './workflow-actor-host.js';
import { WorkflowInteractionRouter } from './workflow-interaction-router.js';

class MemoryWorkflowRunRepository implements IWorkflowRunRepository {
  readonly records = new Map<string, WorkflowRunRecord>();

  async save(record: WorkflowRunRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }

  async get(runId: string): Promise<WorkflowRunRecord | null> {
    const record = this.records.get(runId);
    return record ? structuredClone(record) : null;
  }

  async findActiveBySession(sessionId: string): Promise<WorkflowRunRecord | null> {
    const record = [...this.records.values()].find(
      (candidate) => candidate.status === 'active' && candidate.activeSessionId === sessionId
    );
    return record ? structuredClone(record) : null;
  }
}

describe('WorkflowInteractionRouter', () => {
  it('routes a later typed event to the live actor selected by active session', async () => {
    const machine = setup({
      types: {
        context: {} as { answer?: string },
        events: {} as { type: 'ANSWER'; value: string },
      },
    }).createMachine({
      initial: 'waiting',
      context: {},
      output: ({ context }) => context.answer,
      states: {
        waiting: {
          on: {
            ANSWER: {
              target: 'complete',
              actions: assign({ answer: ({ event }) => event.value }),
            },
          },
        },
        complete: { type: 'final' },
      },
    });
    const repository = new MemoryWorkflowRunRepository();
    const host = new WorkflowActorHost(repository);
    const router = new WorkflowInteractionRouter(repository, host);
    const handle = await host.start({
      runId: 'session-routed-run',
      definitionId: 'waiting-workflow',
      definitionVersion: '1',
      actorLogic: machine,
      input: {},
      activeSessionId: 'session-1',
      activeActorPath: 'workflowChatInvocation_business',
    });

    await expect(router.resolveActiveRun('session-1')).resolves.toMatchObject({ id: handle.id });
    await expect(router.resolveActiveInteraction('session-1')).resolves.toEqual({
      runId: handle.id,
      sessionId: 'session-1',
      actorPath: 'workflowChatInvocation_business',
      cursor: `${handle.id}:workflowChatInvocation_business`,
    });
    await expect(router.dispatch('session-1', { type: 'ANSWER', value: 'approved' })).resolves.toMatchObject({
      id: handle.id,
    });
    await expect(handle.waitForDone()).resolves.toBe('approved');
  });

  it('dispatches a chat turn through the active workflow cursor and returns assistant text', async () => {
    const chatActor = createDurableChatActor({
      processTurn: async ({ message }) => ({ assistantMessage: `Echo: ${message}` }),
      checkCompletion: async () => ({ done: false }),
      finalize: async () => ({ done: true }),
    });
    const machine = setup({
      types: {
        events: {} as { type: 'CHAT_TURN'; message: string } | { type: 'RETURN_ATTEMPT' },
      },
      actors: {
        chatActor,
      },
    }).createMachine({
      initial: 'chat',
      states: {
        chat: {
          invoke: {
            id: 'workflowChatInvocation_business',
            src: 'chatActor',
            input: {
              sessionId: 'session-1',
              systemPrompt: 'Keep scope focused.',
              toolAllowlist: ['com_ask'],
            },
          },
          on: {
            CHAT_TURN: {
              actions: sendTo('workflowChatInvocation_business', ({ event }) => event),
            },
            RETURN_ATTEMPT: {
              actions: sendTo('workflowChatInvocation_business', ({ event }) => event),
            },
          },
        },
      },
    });
    const repository = new MemoryWorkflowRunRepository();
    const host = new WorkflowActorHost(repository);
    const router = new WorkflowInteractionRouter(repository, host);

    await host.start({
      runId: 'session-chat-run',
      definitionId: 'chat-workflow',
      definitionVersion: '1',
      actorLogic: machine,
      input: {},
      activeSessionId: 'session-1',
      activeActorPath: 'workflowChatInvocation_business',
    });

    const interaction = await router.resolveActiveInteraction('session-1');
    const result = await router.dispatchChatTurn(
      'session-1',
      'Hello workflow child',
      interaction?.cursor
    );
    expect(result).toEqual({ assistantMessage: 'Echo: Hello workflow child' });
  });

  it('dispatches a chat turn directly to a nested active workflow actor path', async () => {
    const chatActor = createDurableChatActor({
      processTurn: async ({ message }) => ({ assistantMessage: `Nested: ${message}` }),
      checkCompletion: async () => ({ done: false }),
      finalize: async () => ({ done: true }),
    });
    const childMachine = setup({
      types: {
        events: {} as { type: 'CHAT_TURN'; message: string } | { type: 'RETURN_ATTEMPT' },
      },
      actors: { chatActor },
    }).createMachine({
      initial: 'chat',
      states: {
        chat: {
          invoke: {
            id: 'workflowChatInvocation_business',
            src: 'chatActor',
            input: {
              sessionId: 'session-1',
              systemPrompt: 'Nested scope.',
              toolAllowlist: ['com_ask'],
            },
          },
        },
      },
    });
    const parentMachine = setup({
      actors: { workflowChild: childMachine },
    }).createMachine({
      initial: 'child',
      states: {
        child: {
          invoke: {
            id: 'workflowCommand_invoke-child',
            src: 'workflowChild',
            input: {},
          },
        },
      },
    });
    const repository = new MemoryWorkflowRunRepository();
    const host = new WorkflowActorHost(repository);
    const router = new WorkflowInteractionRouter(repository, host);

    await host.start({
      runId: 'session-chat-run-nested',
      definitionId: 'chat-workflow',
      definitionVersion: '1',
      actorLogic: parentMachine,
      input: {},
      activeSessionId: 'session-1',
      activeActorPath: 'workflowCommand_invoke-child.workflowChatInvocation_business',
    });

    const interaction = await router.resolveActiveInteraction('session-1');
    const result = await router.dispatchChatTurn(
      'session-1',
      'Hello nested child',
      interaction?.cursor
    );
    expect(result).toEqual({ assistantMessage: 'Nested: Hello nested child' });
  });

  it('returns null when no active workflow interaction exists for the session', async () => {
    const repository = new MemoryWorkflowRunRepository();
    const host = new WorkflowActorHost(repository);
    const router = new WorkflowInteractionRouter(repository, host);

    await expect(router.dispatchChatTurn('missing-session', 'hello')).resolves.toBeNull();
  });

  it('rejects chat-turn dispatch when the persisted cursor no longer matches', async () => {
    const chatActor = createDurableChatActor({
      processTurn: async ({ message }) => ({ assistantMessage: `Echo: ${message}` }),
      checkCompletion: async () => ({ done: false }),
      finalize: async () => ({ done: true }),
    });
    const machine = setup({
      types: {
        events: {} as { type: 'CHAT_TURN'; message: string } | { type: 'RETURN_ATTEMPT' },
      },
      actors: { chatActor },
    }).createMachine({
      initial: 'chat',
      states: {
        chat: {
          invoke: {
            id: 'workflowChatInvocation_business',
            src: 'chatActor',
            input: {
              sessionId: 'session-1',
              systemPrompt: 'Keep scope focused.',
              toolAllowlist: ['com_ask'],
            },
          },
          on: {
            CHAT_TURN: {
              actions: sendTo('workflowChatInvocation_business', ({ event }) => event),
            },
            RETURN_ATTEMPT: {
              actions: sendTo('workflowChatInvocation_business', ({ event }) => event),
            },
          },
        },
      },
    });
    const repository = new MemoryWorkflowRunRepository();
    const host = new WorkflowActorHost(repository);
    const router = new WorkflowInteractionRouter(repository, host);

    await host.start({
      runId: 'session-chat-run-2',
      definitionId: 'chat-workflow',
      definitionVersion: '1',
      actorLogic: machine,
      input: {},
      activeSessionId: 'session-1',
      activeActorPath: 'workflowChatInvocation_business',
    });

    await expect(
      router.dispatchChatTurn(
        'session-1',
        'Hello workflow child',
        'session-chat-run-2:workflowChatInvocation_outdated'
      )
    ).rejects.toThrow(/cursor mismatch/i);
  });

  it('rejects typed dispatch when the persisted cursor no longer matches', async () => {
    const machine = setup({
      types: {
        context: {} as { answer?: string },
        events: {} as { type: 'ANSWER'; value: string },
      },
    }).createMachine({
      initial: 'waiting',
      context: {},
      states: {
        waiting: {
          on: {
            ANSWER: {
              target: 'complete',
              actions: assign({ answer: ({ event }) => event.value }),
            },
          },
        },
        complete: { type: 'final' },
      },
    });
    const repository = new MemoryWorkflowRunRepository();
    const host = new WorkflowActorHost(repository);
    const router = new WorkflowInteractionRouter(repository, host);

    await host.start({
      runId: 'session-routed-run-2',
      definitionId: 'waiting-workflow',
      definitionVersion: '1',
      actorLogic: machine,
      input: {},
      activeSessionId: 'session-1',
      activeActorPath: 'workflowChatInvocation_business',
    });

    await expect(
      router.dispatch(
        'session-1',
        { type: 'ANSWER', value: 'approved' },
        'session-routed-run-2:workflowChatInvocation_outdated'
      )
    ).rejects.toThrow(/cursor mismatch/i);
  });
});
