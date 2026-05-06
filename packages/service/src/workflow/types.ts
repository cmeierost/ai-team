import type { InteractionContext } from '@ai-team/api-contracts';

// ─── Step kinds ───────────────────────────────────────────────────────────────

export type WorkflowStepKind = 'action' | 'confirm' | 'input' | 'select' | 'password' | 'checklist';

// ─── Base step ────────────────────────────────────────────────────────────────

interface WorkflowStepBase<TState> {
  id: string;
  kind: WorkflowStepKind;
  skipWhen?: (state: TState) => boolean;
}

// ─── Action step ──────────────────────────────────────────────────────────────

export interface ActionStep<TState> extends WorkflowStepBase<TState> {
  kind: 'action';
  execute: (state: TState, context: InteractionContext) => Promise<TState>;
}

// ─── Question steps ───────────────────────────────────────────────────────────

export interface ConfirmStep<TState> extends WorkflowStepBase<TState> {
  kind: 'confirm';
  message: string | ((state: TState) => string);
  default?: boolean;
  onDeclined: 'abort' | 'skip';
}

export interface InputStep<TState> extends WorkflowStepBase<TState> {
  kind: 'input';
  message: string | ((state: TState) => string);
  validate?: (value: string) => true | string;
  applyAnswer: (state: TState, answer: string) => TState;
}

export interface SelectStep<TState> extends WorkflowStepBase<TState> {
  kind: 'select';
  message: string | ((state: TState) => string);
  choices: (state: TState) => Array<{ name: string; value: string }>;
  applyAnswer: (state: TState, answer: string) => TState;
}

export interface PasswordStep<TState> extends WorkflowStepBase<TState> {
  kind: 'password';
  message: string | ((state: TState) => string);
  applyAnswer: (state: TState, answer: string) => TState;
}

export interface ChecklistStep<TState> extends WorkflowStepBase<TState> {
  kind: 'checklist';
  message: string | ((state: TState) => string);
  choices: (state: TState) => Array<{ name: string; value: string }>;
  minSelections?: number;
  maxSelections?: number;
  applyAnswer: (state: TState, answer: string[]) => TState;
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type WorkflowStep<TState> =
  | ActionStep<TState>
  | ConfirmStep<TState>
  | InputStep<TState>
  | SelectStep<TState>
  | PasswordStep<TState>
  | ChecklistStep<TState>;

// ─── Workflow definition ──────────────────────────────────────────────────────

export interface WorkflowDefinition<TState> {
  id: string;
  steps: WorkflowStep<TState>[];
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface WorkflowResult<TState> {
  state: TState;
  aborted: boolean;
}
