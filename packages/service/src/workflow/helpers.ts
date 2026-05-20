import type {
  RuntimeStreamEvent,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-contracts';
import type { IWorkflowService } from './workflow-service.js';

export interface WorkflowRuntimeContext {
  signal?: AbortSignal;
  workflowService?: IWorkflowService;
  emit?: (event: RuntimeStreamEvent) => void;
}

export function resolveWorkflowAnswer(
  context: WorkflowRuntimeContext | undefined,
  request: { workflow?: { workflowId?: string; questionId?: string } }
): QuestionAnswerValue | undefined {
  return context?.workflowService?.resolveAnswer(request);
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
  context?.workflowService?.emitQuestionFrame(request);
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
  context?.workflowService?.emitResultFrame(request, result);
}

export function ensureNotAborted(context: WorkflowRuntimeContext | undefined): void {
  if (context?.signal?.aborted) {
    throw new Error('Workflow aborted');
  }
}
