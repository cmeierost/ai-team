import { describe, expect, it, vi } from 'vitest';
import type { IWorkflowOperationRepository, WorkflowOperationRecord } from '@ai-team/core';
import { WorkflowOperationJournal } from './workflow-operation-journal.js';

class MemoryWorkflowOperationRepository implements IWorkflowOperationRepository {
  readonly records = new Map<string, WorkflowOperationRecord>();
  private key(runId: string, operationKey: string): string {
    return `${runId}:${operationKey}`;
  }
  async get(runId: string, operationKey: string): Promise<WorkflowOperationRecord | null> {
    return this.records.get(this.key(runId, operationKey)) ?? null;
  }
  async save(record: WorkflowOperationRecord): Promise<void> {
    this.records.set(this.key(record.runId, record.operationKey), structuredClone(record));
  }
}

describe('WorkflowOperationJournal', () => {
  it('returns durable completed output without repeating the side effect', async () => {
    const repository = new MemoryWorkflowOperationRepository();
    const journal = new WorkflowOperationJournal(repository);
    const operation = vi.fn(async () => ({ approved: true }));

    await expect(journal.execute('run-1', 'finalize:business:1', { revision: 3 }, operation)).resolves.toEqual({
      approved: true,
    });
    await expect(journal.execute('run-1', 'finalize:business:1', { revision: 3 }, operation)).resolves.toEqual({
      approved: true,
    });

    expect(operation).toHaveBeenCalledOnce();
    await expect(repository.get('run-1', 'finalize:business:1')).resolves.toMatchObject({
      status: 'completed',
      output: { approved: true },
    });
  });
});
