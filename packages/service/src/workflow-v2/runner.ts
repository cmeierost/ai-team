import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@ai-team/core';
import {
  WorkflowV2AbortError,
  type WorkflowV2Definition,
  type WorkflowV2RunOptions,
  type WorkflowV2RunResult,
  type WorkflowV2Step,
  type WorkflowV2StepFrame,
} from './types.js';
import { WorkflowV2ErrorFormatter } from './error-formatter.js';

export interface IWorkflowV2Runner {
  run<TState>(
    definition: WorkflowV2Definition<TState>,
    initialState: TState,
    options?: WorkflowV2RunOptions
  ): Promise<WorkflowV2RunResult<TState>>;
}

export interface WorkflowV2RunnerOptions {
  createInstanceId?: () => string;
}

export class WorkflowV2Runner implements IWorkflowV2Runner {
  private readonly createInstanceId: () => string;
  private readonly errorFormatter: WorkflowV2ErrorFormatter;

  constructor(options: WorkflowV2RunnerOptions = {}) {
    this.createInstanceId = options.createInstanceId ?? randomUUID;
    this.errorFormatter = new WorkflowV2ErrorFormatter();
  }

  async run<TState>(
    definition: WorkflowV2Definition<TState>,
    initialState: TState,
    options?: WorkflowV2RunOptions
  ): Promise<WorkflowV2RunResult<TState>> {
    const workflowInstanceId = `${definition.id}:${this.createInstanceId()}`;
    const completedStepIds: string[] = [];
    const skippedStepIds: string[] = [];
    let state = initialState;

    for (const step of definition.steps) {
      if (options?.signal?.aborted) {
        return { state, aborted: true, completedStepIds, skippedStepIds };
      }

      const ctx: ExecutionContext = {
        ...(options?.executionContext ?? { history: [] }),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        workflowId: definition.id,
        workflowInstanceId,
        stepId: step.id,
      };

      const shouldRun = await this.shouldRunStep(step, state, ctx);
      if (!shouldRun) {
        skippedStepIds.push(step.id);
        this.emitFrame(options, {
          workflowId: definition.id,
          workflowInstanceId,
          stepId: step.id,
          phase: 'skipped',
        });
        continue;
      }

      this.emitFrame(options, {
        workflowId: definition.id,
        workflowInstanceId,
        stepId: step.id,
        phase: 'started',
      });

      try {
        state = await step.execute(state, ctx);
        completedStepIds.push(step.id);
        this.emitFrame(options, {
          workflowId: definition.id,
          workflowInstanceId,
          stepId: step.id,
          phase: 'completed',
        });
      } catch (error) {
        if (error instanceof WorkflowV2AbortError) {
          this.emitFrame(options, {
            workflowId: definition.id,
            workflowInstanceId,
            stepId: step.id,
            phase: 'aborted',
            error: error.message,
          });
          return { state, aborted: true, completedStepIds, skippedStepIds };
        }

        this.emitFrame(options, {
          workflowId: definition.id,
          workflowInstanceId,
          stepId: step.id,
          phase: 'failed',
          error: this.errorFormatter.format(error),
        });
        throw error;
      }
    }

    return { state, aborted: false, completedStepIds, skippedStepIds };
  }

  private async shouldRunStep<TState>(
    step: WorkflowV2Step<TState>,
    state: TState,
    ctx: ExecutionContext
  ): Promise<boolean> {
    if (!step.shouldRun) {
      return true;
    }

    return await step.shouldRun(state, ctx);
  }

  private emitFrame(options: WorkflowV2RunOptions | undefined, frame: WorkflowV2StepFrame): void {
    options?.emitStepFrame?.(frame);
  }
}
