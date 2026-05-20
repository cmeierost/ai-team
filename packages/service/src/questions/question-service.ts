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

/**
 * Partial question listener that may omit some methods.
 * Used as input to factory functions.
 */
export interface IQuestionListeners extends Partial<IQuestionService> {
  signal?: AbortSignal;
  emit?: (event: RuntimeStreamEvent) => void;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}

/**
 * Factory function that creates an IQuestionService from partial listeners and a bound ExecutionContext.
 * The context is captured at construction time and used by all question methods.
 */
export function InteractionQuestionService(
  listeners: IQuestionListeners,
  context?: ExecutionContext
): IQuestionService {
  // Return a service where methods use the bound context
  return {
    input: (request) => {
      if (!listeners.input) {
        return Promise.reject(new Error('No input handler provided'));
      }
      return listeners.input(request);
    },
    confirm: (request) => {
      if (!listeners.confirm) {
        return Promise.reject(new Error('No confirm handler provided'));
      }
      return listeners.confirm(request);
    },
    select: (request) => {
      if (!listeners.select) {
        return Promise.reject(new Error('No select handler provided'));
      }
      return listeners.select(request);
    },
    password: (request) => {
      if (!listeners.password) {
        return Promise.reject(new Error('No password handler provided'));
      }
      return listeners.password(request);
    },
    checklist: (request) => {
      if (!listeners.checklist) {
        return Promise.reject(new Error('No checklist handler provided'));
      }
      return listeners.checklist(request);
    },
    emit: listeners.emit,
    signal: listeners.signal,
    workflowState: listeners.workflowState,
    onWorkflowFrame: listeners.onWorkflowFrame,
  };
}
