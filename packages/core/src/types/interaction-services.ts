/**
 * Interaction contracts shared across runtime surfaces.
 *
 * Core defines one canonical shape used across the repo.
 */

import type { CommandResponse } from './command-types.js';

export interface RuntimeStreamEvent {
  kind:
    | 'status'
    | 'agent_info'
    | 'workspace_info'
    | 'progress'
    | 'log'
    | 'token'
    | 'tool'
    | 'question'
    | 'code_edit_proposal'
    | 'handoff'
    | 'avatar-preview'
    | 'session_switched'
    | 'session_title_updated'
    | 'history_message'
    | 'subworkflow_start'
    | 'subworkflow_end';
  [key: string]: unknown;
}

export interface ToolDenialEvent {
  kind: 'user-denied' | 'policy-denied' | 'execution-failed';
  reasonCode: string;
  message: string;
  blockedPaths?: string[];
  alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
  handoffRecommendation?: {
    possible: boolean;
    requiresUserApproval: true;
    contexts: Array<{ contextId: string; allowedPaths: string[] }>;
  };
}

export interface ToolRuntimePayloadEvent {
  toolName: string;
  outcome: 'request' | 'start' | 'result' | 'error' | 'denied';
  request?: unknown;
  commandResponse?: CommandResponse;
  resultLlm?: unknown;
  denial?: ToolDenialEvent;
}

export interface ChatCommandEmitter {
  write(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  event(event: RuntimeStreamEvent): void;
}

export interface IEmitService extends ChatCommandEmitter {
  signal?: AbortSignal;
  emit(event: RuntimeStreamEvent): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  status(phase: string, message?: string): void;
  token(text: string): void;
  toolEvent(
    toolName: string,
    toolCallId: string | undefined,
    toolPhase: 'start' | 'result' | 'error' | 'denied',
    message?: string,
    toolDenial?: ToolDenialEvent,
    toolResult?: ToolRuntimePayloadEvent
  ): void;
  /**
   * Temporarily route events through a different sink and return a restore
   * function. Used by request-scoped wrappers (e.g. interaction streams).
   */
  bindSink(sink: (event: RuntimeStreamEvent) => void): () => void;
}

export interface QuestionSelectChoice {
  name: string;
  value: string;
  description?: string;
  recommended?: boolean;
}

export interface QuestionWorkflowMetadata {
  workflowId?: string;
  stepId?: string;
  questionId?: string;
  continuationToken?: string;
}

export interface QuestionInputRequest {
  message: string;
  validate?: (value: string) => true | string;
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionConfirmRequest {
  message: string;
  default?: boolean;
  style?: 'confirm' | 'allow';
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionPasswordRequest {
  message: string;
  mask?: string;
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionSelectRequest {
  message: string;
  choices: QuestionSelectChoice[];
  default?: string;
  recommended?: string[];
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionChecklistRequest {
  message: string;
  choices: QuestionSelectChoice[];
  default?: string[];
  recommended?: string[];
  minSelections?: number;
  maxSelections?: number;
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  workflow?: QuestionWorkflowMetadata;
}

export interface WorkflowFrame {
  workflowId: string;
  stepId: string;
  continuationToken?: string;
  question?: unknown;
  completed?: boolean;
  result?: unknown;
  error?: string;
}

export interface WorkflowStateSnapshot {
  workflowId: string;
  continuationToken?: string;
  answers: Record<string, unknown>;
}

export interface IQuestionService {
  input(request: QuestionInputRequest): Promise<string>;
  confirm(request: QuestionConfirmRequest): Promise<boolean>;
  select(request: QuestionSelectRequest): Promise<string>;
  password(request: QuestionPasswordRequest): Promise<string>;
  checklist(request: QuestionChecklistRequest): Promise<string[]>;
}
