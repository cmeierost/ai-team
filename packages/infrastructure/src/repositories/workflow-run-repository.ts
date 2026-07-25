import type { IWorkflowRunRepository, WorkflowRunRecord } from '@ai-team/core';
import { eq } from 'drizzle-orm';
import type { SqliteDrizzleDatabase } from '../storage/sqlite/connection.js';
import * as dbSchema from '../storage/sqlite/schema.js';

type EnsureReadyAsync = () => Promise<void>;
type GetDb = () => SqliteDrizzleDatabase;

export class WorkflowRunRepository implements IWorkflowRunRepository {
  constructor(
    private readonly ensureReadyAsync: EnsureReadyAsync,
    private readonly getDb: GetDb
  ) {}

  async save(record: WorkflowRunRecord): Promise<void> {
    await this.ensureReadyAsync();
    this.getDb()
      .insert(dbSchema.workflowRuns)
      .values(this.toRow(record))
      .onConflictDoUpdate({
        target: dbSchema.workflowRuns.id,
        set: this.toRow(record),
      })
      .run();
  }

  async get(runId: string): Promise<WorkflowRunRecord | null> {
    await this.ensureReadyAsync();
    const row = this.getDb()
      .select()
      .from(dbSchema.workflowRuns)
      .where(eq(dbSchema.workflowRuns.id, runId))
      .get();
    return row ? this.fromRow(row) : null;
  }

  async findActiveBySession(sessionId: string): Promise<WorkflowRunRecord | null> {
    await this.ensureReadyAsync();
    const row = this.getDb()
      .select()
      .from(dbSchema.workflowRuns)
      .where(eq(dbSchema.workflowRuns.activeSessionId, sessionId))
      .get();
    if (!row || row.status !== 'active') return null;
    return this.fromRow(row);
  }

  private toRow(record: WorkflowRunRecord) {
    return {
      id: record.id,
      definitionId: record.definitionId,
      definitionVersion: record.definitionVersion,
      status: record.status,
      inputJson: JSON.stringify(record.input),
      snapshotJson: JSON.stringify(record.snapshot),
      snapshotSequence: record.snapshotSequence,
      rootSessionId: record.rootSessionId ?? null,
      activeSessionId: record.activeSessionId ?? null,
      outputJson: record.output === undefined ? null : JSON.stringify(record.output),
      failureJson: record.failure === undefined ? null : JSON.stringify(record.failure),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt ?? null,
      cancelledAt: record.cancelledAt ?? null,
    };
  }

  private fromRow(row: typeof dbSchema.workflowRuns.$inferSelect): WorkflowRunRecord {
    return {
      id: row.id,
      definitionId: row.definitionId,
      definitionVersion: row.definitionVersion,
      status: row.status as WorkflowRunRecord['status'],
      input: JSON.parse(row.inputJson),
      snapshot: JSON.parse(row.snapshotJson),
      snapshotSequence: row.snapshotSequence,
      rootSessionId: row.rootSessionId ?? undefined,
      activeSessionId: row.activeSessionId ?? undefined,
      output: row.outputJson ? JSON.parse(row.outputJson) : undefined,
      failure: row.failureJson ? JSON.parse(row.failureJson) : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt ?? undefined,
      cancelledAt: row.cancelledAt ?? undefined,
    };
  }
}
