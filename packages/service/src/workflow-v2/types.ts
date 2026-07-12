import type { ExecutionContext } from '@ai-team/core';

export type WorkflowV2StepPhase =
  | 'started'
  | 'completed'
  | 'skipped'
  | 'aborted'
  | 'failed';

export interface WorkflowV2StepFrame {
  workflowId: string;
  workflowInstanceId: string;
  stepId: string;
  phase: WorkflowV2StepPhase;
  error?: string;
}

export interface WorkflowV2Step<TState> {
  readonly id: string;
  shouldRun?(state: TState, ctx: ExecutionContext): boolean | Promise<boolean>;
  execute(state: TState, ctx: ExecutionContext): Promise<TState>;
}

export interface WorkflowV2Definition<TState> {
  readonly id: string;
  readonly steps: readonly WorkflowV2Step<TState>[];
}

export interface WorkflowV2RunOptions {
  executionContext?: ExecutionContext;
  signal?: AbortSignal;
  emitStepFrame?(frame: WorkflowV2StepFrame): void;
}

export interface WorkflowV2RunResult<TState> {
  state: TState;
  aborted: boolean;
  completedStepIds: string[];
  skippedStepIds: string[];
}

export class WorkflowV2AbortError extends Error {
  constructor(message = 'Workflow aborted') {
    super(message);
    this.name = 'WorkflowV2AbortError';
  }
}
