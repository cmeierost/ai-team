/**
 * ChatRuntimeHooks — the contract between the chat command and its caller
 * (CLI, VS Code extension, API server). All I/O and side-effects flow through
 * these callbacks so the command itself stays environment-agnostic.
 */
import type {
  RuntimeStreamEvent,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
  WorkflowFrame,
  WorkflowStateSnapshot,
} from '@ai-team/api-client';

export interface ChatRuntimeHooks {
  /** Abort signal — any pending operation respects this. */
  signal?: AbortSignal;
  /** Emit a structured runtime event to the caller (replaces stdout in non-CLI contexts). */
  emit?: (event: RuntimeStreamEvent) => void;
  /** Prompt the user for free-form text input. */
  questionInput?: (request: QuestionInputRequest) => Promise<string>;
  /** Prompt the user for a yes/no confirmation. */
  questionConfirm?: (request: QuestionConfirmRequest) => Promise<boolean>;
  /** Prompt the user to pick from a list. */
  questionSelect?: (request: QuestionSelectRequest) => Promise<string>;
  /** Prompt the user for a masked password. */
  questionPassword?: (request: QuestionPasswordRequest) => Promise<string>;
  /** Prompt the user for a multi-select checklist. */
  questionChecklist?: (request: QuestionChecklistRequest) => Promise<string[]>;
  /** Pre-populated workflow answers (for replay/resume scenarios). */
  workflowState?: WorkflowStateSnapshot;
  /** Called for each workflow step frame to support multi-step workflow UI. */
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}
