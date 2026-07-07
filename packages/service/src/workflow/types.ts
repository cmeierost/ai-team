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

// ─── Expression types ─────────────────────────────────────────────────────────

export type WorkflowArgScalar = string | number | boolean | null;

/** Explicit literal passthrough (prevents expression parsing/coercion). */
export interface WorkflowLiteralTransform {
  $literal: unknown;
}

/** Return first non-null/non-undefined value. */
export interface WorkflowCoalesceTransform {
  $coalesce: WorkflowArgValue[];
}

/**
 * Map an input array into a derived array value.
 *
 * Example:
 * {
 *   $map: {
 *     from: '{{ceo_names.suggestions}}',
 *     as: 'candidate',
 *     value: { name: '{{candidate}}', value: '{{candidate}}' }
 *   }
 * }
 */
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

/**
 * A workflow expression is a template string that may contain `{{...}}` placeholders.
 *
 * - `{{stepId.field}}`  — reference a field from a previous step's result
 * - `{{stepId[0].field}}` — reference an element from a loop step's array result
 * - `{{index}}`          — current loop iteration index (0-based)
 * - `{{input.field}}`    — reference a workflow input parameter
 * - Literal values are also valid: `"CEO"`, `5`, `true`, `["a", "b"]`, `{ key: "value" }`
 *
 * The parameter resolver evaluates these against accumulated workflow state.
 */

// ─── Step types ───────────────────────────────────────────────────────────────

/**
 * Dispatches a registered tool/command with params derived from state.
 *
 * Two ways to specify params (exactly one must be provided):
 * - `args`   — Declarative template strings (preferred). Each value is a `WorkflowExpression`
 *              like `"{{stepId.field}}"` or a literal. Resolved by the parameter resolver.
 * - `params` — Typed TS callback. Returns the full params object. Use for typed workflows
 *              where template-string interpolation is too limited.
 *
 * `applyResult` maps the raw command response back into state.
 * When omitted, the result is stored under `state[step.id]` (or appended to an array
 * when inside a loop).
 *
 * Throw `WorkflowAbortError` from `applyResult` to abort cleanly.
 */
export interface WorkflowCommandStep<TState> {
  id: string;
  command: string;
  /** Declarative template-string args. Resolved against accumulated state. */
  args?: Record<string, WorkflowArgValue>;
  /** Typed callback returning the params object. Use when template strings are insufficient. */
  params?: (state: TState) => unknown;
  /** Declarative expression guard. Runs in addition to `skipWhen` when provided. */
  when?: string;
  skipWhen?: (state: TState) => boolean;
  applyResult?: (state: TState, result: unknown) => TState;
}

/**
 * Inline step for logic not yet promoted to a named command.
 * Prefer `WorkflowCommandStep` with a real command when possible.
 */
export interface WorkflowExecuteStep<TState> {
  id: string;
  execute: (state: TState, ctx: ExecutionContext) => Promise<TState>;
  /** Declarative expression guard. Runs in addition to `skipWhen` when provided. */
  when?: string;
  skipWhen?: (state: TState) => boolean;
}

/**
 * Loop step — executes child steps while a condition holds.
 *
 * - `while` is a template expression evaluated against state before each iteration.
 *   Truthy values (non-empty string, true, non-zero number, non-empty array/object) continue the loop.
 * - Each iteration appends child step results to arrays in state.
 * - `{{index}}` is available inside loop steps for the current iteration (0-based).
 * - `maxIterations` prevents infinite loops (default 100).
 */
export interface WorkflowLoopStep<TState> {
  kind: 'loop';
  id: string;
  while: string;
  steps: WorkflowStep<TState>[];
  maxIterations?: number;
  /** Declarative expression guard. Runs in addition to `skipWhen` when provided. */
  when?: string;
  skipWhen?: (state: TState) => boolean;
}

export type WorkflowStep<TState> =
  | WorkflowCommandStep<TState>
  | WorkflowExecuteStep<TState>
  | WorkflowLoopStep<TState>;

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
export interface WorkflowDefinition<TState> extends Omit<ICommandDescriptor, 'key'> {
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
  /**
   * Declarative result projection. Applied when `toResult` is not provided.
   * Supports the same template/expression features as step `args`.
   */
  result?: WorkflowArgValue;

  // ── Steps ────────────────────────────────────────────────────────────────
  readonly steps: WorkflowStep<TState>[];
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface WorkflowResult<TState> {
  state: TState;
  aborted: boolean;
}
