import type {
  WorkflowFrame,
  WorkflowStateSnapshot,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-contracts';

/**
 * Encapsulates workflow-replay state and step-frame emission.
 *
 * Separating this from IQuestionService keeps question handling free of
 * workflow persistence concerns, and allows the runner to receive workflow
 * behaviour via a focused interface instead of a broad context bag.
 */
export interface IWorkflowService {
  /** Snapshot provided for workflow replay/resumption. */
  readonly workflowState?: WorkflowStateSnapshot;

  /** Returns a previously recorded answer for the given question, or undefined if not replaying. */
  resolveAnswer(request: {
    workflow?: { workflowId?: string; questionId?: string };
  }): QuestionAnswerValue | undefined;

  /** Emits a frame indicating a question step is active. */
  emitQuestionFrame(
    request: (
      | ({ kind: 'input' } & QuestionInputRequest)
      | ({ kind: 'confirm' } & QuestionConfirmRequest)
      | ({ kind: 'select' } & QuestionSelectRequest)
      | ({ kind: 'password' } & QuestionPasswordRequest)
      | ({ kind: 'checklist' } & QuestionChecklistRequest)
    ) & { workflow?: { workflowId?: string; stepId?: string; continuationToken?: string } }
  ): void;

  /** Emits a frame recording the answer to a question step. */
  emitResultFrame(
    request: {
      workflow?: {
        workflowId?: string;
        stepId?: string;
        continuationToken?: string;
        questionId?: string;
      };
    },
    result: QuestionAnswerValue
  ): void;

  /** Emits a generic step-lifecycle frame (start / completion). */
  emitStepFrame(frame: WorkflowFrame): void;
}

// ─── DefaultWorkflowService ───────────────────────────────────────────────────

/**
 * Standard implementation that reads replay answers from a snapshot and
 * forwards all frames to an optional `onFrame` callback.
 */
export class DefaultWorkflowService implements IWorkflowService {
  constructor(
    readonly workflowState?: WorkflowStateSnapshot,
    private readonly onFrame?: (frame: WorkflowFrame) => void
  ) {}

  resolveAnswer(request: {
    workflow?: { workflowId?: string; questionId?: string };
  }): QuestionAnswerValue | undefined {
    const workflowId = request.workflow?.workflowId;
    const questionId = request.workflow?.questionId;
    if (!workflowId || !questionId) return undefined;
    if (this.workflowState?.workflowId !== workflowId) return undefined;
    return this.workflowState.answers[questionId];
  }

  emitQuestionFrame(
    request: (
      | ({ kind: 'input' } & QuestionInputRequest)
      | ({ kind: 'confirm' } & QuestionConfirmRequest)
      | ({ kind: 'select' } & QuestionSelectRequest)
      | ({ kind: 'password' } & QuestionPasswordRequest)
      | ({ kind: 'checklist' } & QuestionChecklistRequest)
    ) & { workflow?: { workflowId?: string; stepId?: string; continuationToken?: string } }
  ): void {
    const workflowId = request.workflow?.workflowId;
    if (!workflowId) return;
    this.onFrame?.({
      workflowId,
      stepId: request.workflow?.stepId ?? 'question',
      continuationToken: request.workflow?.continuationToken,
      question: request,
    });
  }

  emitResultFrame(
    request: {
      workflow?: {
        workflowId?: string;
        stepId?: string;
        continuationToken?: string;
        questionId?: string;
      };
    },
    result: QuestionAnswerValue
  ): void {
    const workflowId = request.workflow?.workflowId;
    if (!workflowId) return;
    this.onFrame?.({
      workflowId,
      stepId: request.workflow?.stepId ?? 'question',
      continuationToken: request.workflow?.continuationToken,
      question: request.workflow?.questionId
        ? { kind: 'input', message: '', workflow: request.workflow }
        : undefined,
      result,
    });
  }

  emitStepFrame(frame: WorkflowFrame): void {
    this.onFrame?.(frame);
  }
}

// ─── NoopWorkflowService ──────────────────────────────────────────────────────

/**
 * No-op implementation used when workflow replay and frame emission are
 * not needed (e.g. direct tool invocations that happen to call runWorkflowAsync).
 */
export class NoopWorkflowService implements IWorkflowService {
  readonly workflowState = undefined;
  resolveAnswer(): undefined {
    return undefined;
  }
  emitQuestionFrame(): void {
    /* noop */
  }
  emitResultFrame(): void {
    /* noop */
  }
  emitStepFrame(): void {
    /* noop */
  }
}
