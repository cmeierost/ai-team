import type { ICommandDescriptor, ExecutionContext, IServiceContainer } from '@ai-team/core';

export class WorkflowAbortError extends Error {
  constructor() {
    super('Workflow aborted');
    this.name = 'WorkflowAbortError';
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
