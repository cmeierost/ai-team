import type {
  InteractionContext,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-client';

export function resolveWorkflowAnswer(
  context: InteractionContext | undefined,
  request: { workflow?: { workflowId?: string; questionId?: string } }
): QuestionAnswerValue | undefined {
  const workflowId = request.workflow?.workflowId;
  const questionId = request.workflow?.questionId;
  if (!workflowId || !questionId) {
    return undefined;
  }

  if (context?.workflowState?.workflowId !== workflowId) {
    return undefined;
  }

  return context.workflowState.answers[questionId];
}

export function emitWorkflowQuestionFrame(
  context: InteractionContext | undefined,
  request:
    | ({ kind: 'input' } & QuestionInputRequest)
    | ({ kind: 'confirm' } & QuestionConfirmRequest)
    | ({ kind: 'select' } & QuestionSelectRequest)
    | ({ kind: 'password' } & QuestionPasswordRequest)
    | ({ kind: 'checklist' } & QuestionChecklistRequest)
): void {
  const workflowId = request.workflow?.workflowId;
  if (!workflowId) {
    return;
  }

  context?.onWorkflowFrame?.({
    workflowId,
    stepId: request.workflow?.stepId || 'question',
    continuationToken: request.workflow?.continuationToken,
    question: request,
  });
}

export function emitWorkflowResultFrame(
  context: InteractionContext | undefined,
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
  if (!workflowId) {
    return;
  }

  context?.onWorkflowFrame?.({
    workflowId,
    stepId: request.workflow?.stepId || 'question',
    continuationToken: request.workflow?.continuationToken,
    question: request.workflow?.questionId
      ? {
          kind: 'input',
          message: '',
          workflow: request.workflow,
        }
      : undefined,
    result,
  });
}

export function ensureNotAborted(context: InteractionContext | undefined): void {
  if (context?.signal?.aborted) {
    throw new Error('Workflow aborted');
  }
}
