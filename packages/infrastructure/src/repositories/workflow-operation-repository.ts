import type { IWorkflowOperationRepository, WorkflowOperationRecord } from '@ai-team/core';
import { and, eq } from 'drizzle-orm';
import type { SqliteDrizzleDatabase } from '../storage/sqlite/connection.js';
import * as dbSchema from '../storage/sqlite/schema.js';

export class WorkflowOperationRepository implements IWorkflowOperationRepository {
  constructor(
    private readonly ensureReadyAsync: () => Promise<void>,
    private readonly getDb: () => SqliteDrizzleDatabase
  ) {}

  async get(runId: string, operationKey: string): Promise<WorkflowOperationRecord | null> {
    await this.ensureReadyAsync();
    const row = this.getDb().select().from(dbSchema.workflowOperations).where(
      and(eq(dbSchema.workflowOperations.runId, runId), eq(dbSchema.workflowOperations.operationKey, operationKey))
    ).get();
    return row ? this.fromRow(row) : null;
  }

  async save(record: WorkflowOperationRecord): Promise<void> {
    await this.ensureReadyAsync();
    this.getDb().insert(dbSchema.workflowOperations).values(this.toRow(record)).onConflictDoUpdate({
      target: [dbSchema.workflowOperations.runId, dbSchema.workflowOperations.operationKey],
      set: this.toRow(record),
    }).run();
  }

  private toRow(record: WorkflowOperationRecord) {
    return {
      runId: record.runId,
      operationKey: record.operationKey,
      status: record.status,
      inputJson: JSON.stringify(record.input),
      outputJson: record.output === undefined ? null : JSON.stringify(record.output),
      failureJson: record.failure === undefined ? null : JSON.stringify(record.failure),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private fromRow(row: typeof dbSchema.workflowOperations.$inferSelect): WorkflowOperationRecord {
    return {
      runId: row.runId,
      operationKey: row.operationKey,
      status: row.status as WorkflowOperationRecord['status'],
      input: JSON.parse(row.inputJson),
      output: row.outputJson ? JSON.parse(row.outputJson) : undefined,
      failure: row.failureJson ? JSON.parse(row.failureJson) : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
