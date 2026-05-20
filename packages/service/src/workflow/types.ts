import type { ICommandDescriptor, ExecutionContext } from '@ai-team/core';

// ─── Abort ────────────────────────────────────────────────────────────────────

/**
 * Throw from `applyResult` to abort the workflow cleanly.
 * The runner catches this and returns `{ state, aborted: true }`.
 */
export class WorkflowAbortError extends Error {
  constructor() {
    super('Workflow aborted');
    this.name = 'WorkflowAbortError';
  }
}

// ─── Step types ───────────────────────────────────────────────────────────────

/**
 * Dispatches a registered command with params derived from current state.
 * `applyResult` maps the raw command response back into state.
 * Throw `WorkflowAbortError` from `applyResult` to abort cleanly.
 */
export interface WorkflowCommandStep<TState> {
  id: string;
  command: string;
  skipWhen?: (state: TState) => boolean;
  params: (state: TState) => unknown;
  applyResult?: (state: TState, result: unknown) => TState;
}

/**
 * Inline step for logic not yet promoted to a named command.
 * Prefer `WorkflowCommandStep` with a real command when possible.
 */
export interface WorkflowExecuteStep<TState> {
  id: string;
  execute: (state: TState, ctx: ExecutionContext) => Promise<TState>;
  skipWhen?: (state: TState) => boolean;
}

export type WorkflowStep<TState> = WorkflowCommandStep<TState> | WorkflowExecuteStep<TState>;

// ─── Workflow definition ──────────────────────────────────────────────────────

/**
 * A workflow definition extends the full command metadata surface via `ICommandDescriptor`.
 * `description` and `availableIn` are required — matching the same contract as `ICommand`.
 *
 * Use `WorkflowRunnerFactory.asCommand()` to register any definition as a
 * first-class command with no wrapper class.
 *
 * - `prepare`   maps command params to the initial workflow state (identity fallback).
 * - `toResult`  extracts the command result from the final state (full state fallback).
 */
export interface WorkflowDefinition<TState> extends ICommandDescriptor {
  /** Serves as both workflow identifier and command key. */
  readonly id: string;

  // ── Command adapter hooks ───────────────────────────────────────────
  /**
   * Maps raw command params to the initial workflow state.
   * When absent, params are cast to `TState` directly.
   */
  prepare?: (params: unknown) => TState;
  /**
   * Extracts the command result from the final workflow state.
   * When absent, the full state is returned.
   */
  toResult?: (state: TState) => unknown;

  // ── Steps ────────────────────────────────────────────────────────────────
  readonly steps: WorkflowStep<TState>[];
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface WorkflowResult<TState> {
  state: TState;
  aborted: boolean;
}
