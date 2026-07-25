import { describe, expect, it } from 'vitest';
import { assign, setup } from 'xstate';
import type { IWorkflowRunRepository, WorkflowRunRecord } from '@ai-team/core';
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
    });

    await expect(router.resolveActiveRun('session-1')).resolves.toMatchObject({ id: handle.id });
    await expect(router.dispatch('session-1', { type: 'ANSWER', value: 'approved' })).resolves.toMatchObject({
      id: handle.id,
    });
    await expect(handle.waitForDone()).resolves.toBe('approved');
  });
});
