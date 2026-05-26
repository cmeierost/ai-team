import type {
  QuestionInputRequest,
  QuestionConfirmRequest,
  QuestionSelectRequest,
  QuestionPasswordRequest,
  QuestionChecklistRequest,
  RuntimeStreamEvent,
  WorkflowStateSnapshot,
  WorkflowFrame,
} from '@ai-team/api-contracts';

export type {
  QuestionInputRequest,
  QuestionConfirmRequest,
  QuestionSelectRequest,
  QuestionPasswordRequest,
  QuestionChecklistRequest,
};

export interface IQuestionService {
  input(request: QuestionInputRequest): Promise<string>;
  confirm(request: QuestionConfirmRequest): Promise<boolean>;
  select(request: QuestionSelectRequest): Promise<string>;
  password(request: QuestionPasswordRequest): Promise<string>;
  checklist(request: QuestionChecklistRequest): Promise<string[]>;
  emit?: (event: RuntimeStreamEvent) => void;
  signal?: AbortSignal;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}

/** @deprecated Pass an IInteractionService object directly. */
export function InteractionQuestionService(
  handlers: Partial<IQuestionService>
): IQuestionService {
  return handlers as IQuestionService;
}
