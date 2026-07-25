import type { IWorkflowOperationRepository } from '@ai-team/core';

/** Reuses completed output for one stable side-effect/finalizer operation key. */
export class WorkflowOperationJournal {
  constructor(private readonly operations: IWorkflowOperationRepository) {}

  async execute<TOutput>(
    runId: string,
    operationKey: string,
    input: unknown,
    operation: () => Promise<TOutput>
  ): Promise<TOutput> {
    const existing = await this.operations.get(runId, operationKey);
    if (existing?.status === 'completed') return existing.output as TOutput;

    const now = new Date().toISOString();
    await this.operations.save({
      runId,
      operationKey,
      status: 'started',
      input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    try {
      const output = await operation();
      await this.operations.save({
        runId,
        operationKey,
        status: 'completed',
        input,
        output,
        createdAt: existing?.createdAt ?? now,
        updatedAt: new Date().toISOString(),
      });
      return output;
    } catch (error) {
      await this.operations.save({
        runId,
        operationKey,
        status: 'failed',
        input,
        failure: { message: error instanceof Error ? error.message : String(error) },
        createdAt: existing?.createdAt ?? now,
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }
}
