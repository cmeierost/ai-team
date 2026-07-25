import { describe, expect, it } from 'vitest';
import { assign, setup } from 'xstate';
import type { IWorkflowRunRepository, WorkflowRunRecord } from '@ai-team/core';
import { WorkflowActorHost } from './workflow-actor-host.js';

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
    for (const record of this.records.values()) {
      if (record.status === 'active' && record.activeSessionId === sessionId) {
        return structuredClone(record);
      }
    }
    return null;
  }
}

describe('WorkflowActorHost', () => {
  it('checkpoints and restores a durable waiting actor before completing it', async () => {
    const machine = setup({
      types: {
        context: {} as { answer?: string },
        events: {} as { type: 'ANSWER'; value: string },
      },
    }).createMachine({
      id: 'durable-test',
      initial: 'waiting',
      context: {},
      output: ({ context }) => ({ answer: context.answer }),
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
    const initial = await host.start({
      runId: 'run-host-1',
      definitionId: 'durable-test',
      definitionVersion: '1',
      actorLogic: machine,
      input: {},
      activeSessionId: 'session-1',
    });

    const persisted = await initial.checkpoint();
    expect(persisted.snapshot).toMatchObject({ value: 'waiting' });
    const restored = await host.restore({
      runId: 'run-host-1',
      definitionId: 'durable-test',
      definitionVersion: '1',
      actorLogic: machine,
    });

    await restored.dispatch({ type: 'ANSWER', value: 'approved' });
    await expect(restored.waitForDone()).resolves.toEqual({ answer: 'approved' });
    await expect(repository.get('run-host-1')).resolves.toMatchObject({
      status: 'completed',
      output: { answer: 'approved' },
    });
  });

  it('persists explicit cancellation instead of completing the actor', async () => {
    const machine = setup({
      types: { events: {} as { type: 'NOT_USED' } },
    }).createMachine({
      initial: 'waiting',
      states: { waiting: {} },
    });
    const repository = new MemoryWorkflowRunRepository();
    const handle = await new WorkflowActorHost(repository).start({
      runId: 'run-host-cancel',
      definitionId: 'durable-test',
      definitionVersion: '1',
      actorLogic: machine,
      input: {},
    });

    await handle.cancel();

    expect(handle.getStatus()).toBe('cancelled');
    await expect(repository.get('run-host-cancel')).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('checkpoints the root snapshot when an invoked child advances without a root transition', async () => {
    const child = setup({}).createMachine({
      initial: 'waiting',
      states: {
        waiting: { after: { 10: 'advanced' } },
        advanced: {},
      },
    });
    const parent = setup({ actors: { child } }).createMachine({
      initial: 'running',
      states: {
        running: { invoke: { id: 'child', src: 'child' } },
      },
    });
    const repository = new MemoryWorkflowRunRepository();
    const handle = await new WorkflowActorHost(repository).start({
      runId: 'run-host-child-checkpoint',
      definitionId: 'parent',
      definitionVersion: '1',
      actorLogic: parent,
      input: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    const persisted = await repository.get(handle.id);

    expect(JSON.stringify(persisted?.snapshot)).toContain('advanced');
    await handle.cancel();
  });
});
