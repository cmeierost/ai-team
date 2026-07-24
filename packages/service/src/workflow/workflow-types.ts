import type { ICommandDescriptor, ExecutionContext, IServiceContainer } from '@ai-team/core';

export class WorkflowAbortError extends Error {
  readonly reasonMessage?: string;

  constructor(reason?: unknown) {
    super('Workflow aborted');
    this.name = 'WorkflowAbortError';
    this.reasonMessage = WorkflowAbortError.toReasonMessage(reason);
  }

  private static toReasonMessage(reason: unknown): string | undefined {
    if (reason instanceof Error) return reason.message || undefined;
    if (typeof reason === 'string') return reason || undefined;
    if (reason === undefined || reason === null) return undefined;
    try {
      return JSON.stringify(reason) || undefined;
    } catch {
      return String(reason);
    }
  }
}

export type WorkflowArgScalar = string | number | boolean | null;

export interface WorkflowLiteralTransform {
  $literal: unknown;
}

export interface WorkflowCoalesceTransform {
  $coalesce: WorkflowArgValue[];
}

export interface WorkflowMapTransform {
  $map: {
    from: WorkflowArgValue;
    as?: string;
    value: WorkflowArgValue;
  };
}

export type WorkflowArgValue =
  | WorkflowArgScalar
  | WorkflowArgValue[]
  | { [key: string]: WorkflowArgValue }
  | WorkflowLiteralTransform
  | WorkflowCoalesceTransform
  | WorkflowMapTransform;

export interface WorkflowReturnDefinition {
  /** Command executed by the generic /return shortcut. */
  command: string;
  /** Arguments resolved against current workflow state before command execution. */
  args?: Record<string, WorkflowArgValue>;
}

export interface WorkflowCommandStep<TState> {
  id: string;
  command: string;
  args?: Record<string, WorkflowArgValue>;
  params?: (state: TState) => unknown;
  when?: string;
  skipWhen?: string;
  applyResult?: (state: TState, result: unknown) => TState;
}

export interface WorkflowExecuteStep<TState> {
  id: string;
  execute: (state: TState, ctx: ExecutionContext, services: IServiceContainer) => Promise<TState>;
  when?: string;
  skipWhen?: string;
}

export interface WorkflowLoopStep<TState> {
  kind: 'loop';
  id: string;
  while: string;
  steps: WorkflowStep<TState>[];
  maxIterations?: number;
  when?: string;
  skipWhen?: string;
}

export type WorkflowStep<TState> =
  | WorkflowCommandStep<TState>
  | WorkflowExecuteStep<TState>
  | WorkflowLoopStep<TState>;

export interface WorkflowDefinition<TState> extends Omit<ICommandDescriptor, 'key'> {
  readonly id: string;
  /** Optional workflow-defined behavior for returning control to its parent. */
  readonly return?: WorkflowReturnDefinition;
  prepare?: (params: unknown) => TState;
  toResult?: (state: TState) => unknown;
  result?: WorkflowArgValue;
  readonly steps: WorkflowStep<TState>[];
}

export interface WorkflowResult<TState> {
  state: TState;
  aborted: boolean;
  /** Error message captured when the workflow aborted due to a step failure. */
  abortedError?: string;
}
