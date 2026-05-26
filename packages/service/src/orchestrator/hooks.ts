import type {
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
  WorkflowFrame,
  WorkflowStateSnapshot,
} from '@ai-team/api-contracts';
import type { IEmitService } from './services/emit-service.js';

export interface ChatRuntimeHooks {
  emitService?: IEmitService;
  invocationSurface?: 'slash' | 'tool' | 'cli' | 'api';
  signal?: AbortSignal;
  questionInput?: (request: QuestionInputRequest) => Promise<string>;
  questionConfirm?: (request: QuestionConfirmRequest) => Promise<boolean>;
  questionSelect?: (request: QuestionSelectRequest) => Promise<string>;
  questionPassword?: (request: QuestionPasswordRequest) => Promise<string>;
  questionChecklist?: (request: QuestionChecklistRequest) => Promise<string[]>;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}
