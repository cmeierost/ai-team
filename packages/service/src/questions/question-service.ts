import type {
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
  RuntimeStreamEvent,
  WorkflowFrame,
  WorkflowStateSnapshot,
} from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';

/**
 * Core question service interface.
 * Methods do not take ExecutionContext explicitly; context is bound at construction time.
 */
export interface IQuestionService {
  questionInput(request: QuestionInputRequest): Promise<string>;
  questionConfirm(request: QuestionConfirmRequest): Promise<boolean>;
  questionSelect(request: QuestionSelectRequest): Promise<string>;
  questionPassword(request: QuestionPasswordRequest): Promise<string>;
  questionChecklist(request: QuestionChecklistRequest): Promise<string[]>;
  emit?: (event: RuntimeStreamEvent) => void;
  signal?: AbortSignal;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}

/**
 * Partial question listener that may omit some methods.
 * Used as input to factory functions.
 */
export type IQuestionListeners = Partial<IQuestionService>;

/**
 * Factory function that creates an IQuestionService from partial listeners and a bound ExecutionContext.
 * The context is captured at construction time and used by all question methods.
 */
export function InteractionQuestionService(
  listeners: IQuestionListeners,
  context?: ExecutionContext
): IQuestionService {
  return {
    questionInput: (request) => {
      if (!listeners.questionInput) {
        return Promise.reject(new Error('No questionInput handler provided'));
      }
      return listeners.questionInput(request);
    },
    questionConfirm: (request) => {
      if (!listeners.questionConfirm) {
        return Promise.reject(new Error('No questionConfirm handler provided'));
      }
      return listeners.questionConfirm(request);
    },
    questionSelect: (request) => {
      if (!listeners.questionSelect) {
        return Promise.reject(new Error('No questionSelect handler provided'));
      }
      return listeners.questionSelect(request);
    },
    questionPassword: (request) => {
      if (!listeners.questionPassword) {
        return Promise.reject(new Error('No questionPassword handler provided'));
      }
      return listeners.questionPassword(request);
    },
    questionChecklist: (request) => {
      if (!listeners.questionChecklist) {
        return Promise.reject(new Error('No questionChecklist handler provided'));
      }
      return listeners.questionChecklist(request);
    },
    emit: listeners.emit,
    signal: listeners.signal,
    workflowState: listeners.workflowState,
    onWorkflowFrame: listeners.onWorkflowFrame,
  };
}
