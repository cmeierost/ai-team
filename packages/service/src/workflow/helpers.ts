import type {
  RuntimeStreamEvent,
  WorkflowFrame,
  WorkflowStateSnapshot,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-contracts';

export interface WorkflowRuntimeContext {
  signal?: AbortSignal;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
  emit?: (event: RuntimeStreamEvent) => void;
}

export function resolveWorkflowAnswer(
  context: WorkflowRuntimeContext | undefined,
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
  context: WorkflowRuntimeContext | undefined,
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
  context: WorkflowRuntimeContext | undefined,
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

export function ensureNotAborted(context: WorkflowRuntimeContext | undefined): void {
  if (context?.signal?.aborted) {
    throw new Error('Workflow aborted');
  }
}
