export type WorkflowOperationStatus = 'started' | 'completed' | 'failed';

export interface WorkflowOperationRecord {
  runId: string;
  operationKey: string;
  status: WorkflowOperationStatus;
  input: unknown;
  output?: unknown;
  failure?: { message: string };
  createdAt: string;
  updatedAt: string;
}

/** Durable idempotency journal for side effects and workflow finalizers. */
export interface IWorkflowOperationRepository {
  get(runId: string, operationKey: string): Promise<WorkflowOperationRecord | null>;
  save(record: WorkflowOperationRecord): Promise<void>;
}
