export type WorkflowRunStatus = 'active' | 'completed' | 'cancelled' | 'failed';

/**
 * JSON envelope for a durable workflow root actor. It intentionally contains
 * no XState imports or actor references so service owns actor reconstruction.
 */
export interface WorkflowRunRecord {
  id: string;
  definitionId: string;
  definitionVersion: string;
  status: WorkflowRunStatus;
  input: unknown;
  snapshot: unknown;
  snapshotSequence: number;
  rootSessionId?: string;
  activeSessionId?: string;
  /** Stable path of the invoked child actor currently owning interaction, if any. */
  activeActorPath?: string;
  output?: unknown;
  failure?: {
    message: string;
    stepId?: string;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
}

/**
 * The repository serializes root snapshots. The service owns all actor logic,
 * restore compatibility checks, and checkpoint scheduling.
 */
export interface IWorkflowRunRepository {
  save(record: WorkflowRunRecord): Promise<void>;
  get(runId: string): Promise<WorkflowRunRecord | null>;
  findActiveBySession(sessionId: string): Promise<WorkflowRunRecord | null>;
}
