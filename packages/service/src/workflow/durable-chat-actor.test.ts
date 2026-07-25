import { describe, expect, it } from 'vitest';
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

async function flushActorWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('durable chat actor', () => {
  it('keeps its session identity after a rejected return and completes after restore', async () => {
    const completionResults = [
      { done: false, feedback: 'Create and approve business.md before returning.' },
      { done: true },
    ];
    const actorLogic = createDurableChatActor({
      processTurn: async ({ message }) => ({ assistantMessage: `Acknowledged: ${message}` }),
      checkCompletion: async () => completionResults.shift() ?? { done: true },
      finalize: async () => ({ approved: true, documentPath: '.ai-team/business.md' }),
    });
    const repository = new MemoryWorkflowRunRepository();
    const originalHost = new WorkflowActorHost(repository);
    const originalRouter = new WorkflowInteractionRouter(repository, originalHost);
    const initial = await originalHost.start({
      runId: 'business-chat-run',
      definitionId: 'business-chat',
      definitionVersion: '1',
      actorLogic,
      input: {
        sessionId: 'session-ceo-1',
        systemPrompt: 'Help the CEO define the business.',
        toolAllowlist: ['docs_write', 'com_ask'],
      },
      activeSessionId: 'session-ceo-1',
    });

    await originalRouter.dispatch('session-ceo-1', { type: 'CHAT_TURN', message: 'Draft created.' });
    await flushActorWork();
    await originalRouter.dispatch('session-ceo-1', { type: 'RETURN_ATTEMPT' });
    await flushActorWork();

    expect(initial.getStatus()).toBe('active');
    expect(initial.getSnapshot()).toMatchObject({
      value: 'conversing',
      context: {
        sessionId: 'session-ceo-1',
        systemPrompt: 'Help the CEO define the business.',
        toolAllowlist: ['docs_write', 'com_ask'],
        feedback: 'Create and approve business.md before returning.',
      },
    });
    await expect(repository.get(initial.id)).resolves.toMatchObject({
      status: 'active',
      activeSessionId: 'session-ceo-1',
    });

    const restoredHost = new WorkflowActorHost(repository);
    const restoredRouter = new WorkflowInteractionRouter(repository, restoredHost);
    const restored = await restoredHost.restore({
      runId: initial.id,
      definitionId: 'business-chat',
      definitionVersion: '1',
      actorLogic,
    });

    await restoredRouter.dispatch('session-ceo-1', { type: 'RETURN_ATTEMPT' });
    await expect(restored.waitForDone()).resolves.toEqual({
      approved: true,
      documentPath: '.ai-team/business.md',
    });
  });
});
