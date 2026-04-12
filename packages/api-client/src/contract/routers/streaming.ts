import { WebSocketStreamOptions } from '../../websocket';
import { Agent, ContextLevel, ListEmployeesRequest, RoleType } from './agents';
import { LlmProfile } from './config';
import {
  AddProviderOptions,
  ConfigureProviderOptions,
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
  SetProviderOptions,
  TestConnectionOptions,
} from './llm';
import { GraphData, ViewMode } from './team';

export type AiTeamCommandName =
  | 'listEmployees'
  | 'resolveEmployees'
  | 'getTeamGraph'
  | 'getOrganizationGraph'
  | 'create'
  | 'chat'
  | 'hire'
  | 'fire'
  | 'init'
  | 'hhRefresh'
  | 'providerConfigure'
  | 'providerAdd'
  | 'providerSet'
  | 'providerList'
  | 'providerModels'
  | 'providerModelsRefresh'
  | 'testConnection';

export type MediatorRuntimeEvent =
  | {
      kind: 'status';
      phase?: string;
      message?: string;
    }
  | {
      kind: 'agent_info';
      agentId?: string;
      agentName: string;
      agentRole?: string;
      developerName?: string;
      message?: string;
    }
  | {
      kind: 'progress';
      phase?: string;
      percent?: number;
      message?: string;
    }
  | {
      kind: 'log';
      level?: 'info' | 'warn' | 'error' | 'debug';
      message?: string;
    }
  | {
      kind: 'token';
      text?: string;
    }
  | {
      kind: 'tool';
      toolName?: string;
      toolPhase?: 'request' | 'start' | 'result' | 'error' | 'denied';
      message?: string;
      toolDenial?: ToolDenialEvent;
      toolResult?: ToolRuntimePayloadEvent;
    }
  | {
      kind: 'question';
      message?: string;
      questionType?: 'confirm' | 'input' | 'select' | 'password' | 'checklist';
      choices?: QuestionSelectChoice[];
      default?: string | boolean | string[];
      recommended?: string[];
      minSelections?: number;
      maxSelections?: number;
      allowOther?: boolean;
      otherLabel?: string;
      otherPrompt?: string;
    }
  | {
      kind: 'code_edit_proposal';
      message?: string;
      proposalId?: string;
      agentName?: string;
      description?: string;
      filesChanged?: number;
      additions?: number;
      deletions?: number;
      warnings?: string[];
      /** Full file changes — present when kind === 'code_edit_proposal' */
      files?: Array<{
        filePath: string;
        oldContent: string;
        newContent: string;
        additions?: number;
        deletions?: number;
      }>;
    }
  | {
      kind: 'handoff';
      message?: string;
      fromAgentId?: string;
      fromAgentName?: string;
      fromAgentRole?: string;
      fromSessionId?: string;
      toAgentId?: string;
      toAgentName?: string;
      toAgentRole?: string;
      toSessionId?: string;
      handoffNote?: string;
      /** LLM-generated briefing written in the FROM agent's voice */
      briefingContent?: string;
    };

export interface CreateSkillSetupInput {
  kind: 'skill';
  name: string;
  type: RoleType;
  description: string;
  contextLevel: ContextLevel;
  instructions: string;
  llm?: LlmProfile;
}

export type CreateSetupInput = CreateAgentSetupInput | CreateSkillSetupInput;

export interface CreateOptions {
  name?: string;
  role?: string;
  interactive?: boolean;
  setup?: CreateSetupInput;
}

export interface ChatOptions {
  message?: string;
  context?: string[];
  oneShot?: boolean;

  // Session management
  sessionId?: string; // Resume this specific session
  createNewSession?: boolean; // Force create new session instead of resuming latest
  addAgentToSession?: string; // Add another agent to this session (multi-agent mode)

  /** @deprecated No longer used. Messages are always persisted to SQLite via SessionManager. */
  skipPersistence?: boolean;

  /**
   * Introduction text already displayed by the client (e.g. web UI). When provided on an empty-history
   * session, the introduction is persisted (with importance: 'low') immediately before the first user
   * message, without triggering a second LLM call. Mutually exclusive with the CLI introduction flow.
   */
  pendingIntroduction?: string;
}

export interface HireOptions {
  name?: string;
  role?: string;
  skill?: string;
  type?: string;
  reportsTo?: string;
  chat?: boolean;
}

export interface FireOptions {
  force?: boolean;
}

export interface InitOptions {
  template?: string;
  force?: boolean;
}

export interface AiTeamCommandPayloadMap {
  listEmployees: ListEmployeesRequest;
  resolveEmployees: { query: string };
  getTeamGraph: { mode?: ViewMode };
  getOrganizationGraph: Record<string, never>;
  create: { type: string; options: CreateOptions };
  chat: { employeeId?: string; options: ChatOptions };
  hire: { options: HireOptions };
  fire: { employeeQuery: string; options: FireOptions };
  init: { options: InitOptions };
  hhRefresh: Record<string, never>;
  providerConfigure: { options?: ConfigureProviderOptions };
  providerAdd: { options?: AddProviderOptions };
  providerSet: { options?: SetProviderOptions };
  providerList: { options?: ProviderListOptions };
  providerModels: { options: ProviderModelsOptions };
  providerModelsRefresh: { options: RefreshProviderModelsOptions };
  testConnection: { options?: TestConnectionOptions };
}

export interface MediatorRequest<
  TCommand extends keyof AiTeamCommandPayloadMap = keyof AiTeamCommandPayloadMap,
> {
  requestId?: string;
  command: TCommand;
  payload: AiTeamCommandPayloadMap[TCommand];
}

export interface ToolRuntimePayloadEvent {
  toolName: string;
  outcome: 'result' | 'error' | 'denied';
  result?: unknown;
  /** LLM-formatted representation of result — what was injected into the model's context window. */
  resultLlm?: unknown;
  denial?: ToolDenialEvent;
}

export type MediatorEvent<
  TCommand extends AiTeamCommandName & keyof AiTeamCommandResponseMap = AiTeamCommandName,
> =
  | {
      requestId?: string;
      command: TCommand;
      kind: 'started';
      timestamp: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'status';
      timestamp: string;
      phase?: string;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'agent_info';
      timestamp: string;
      agentId?: string;
      agentName: string;
      agentRole?: string;
      developerName?: string;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'progress';
      timestamp: string;
      phase?: string;
      percent?: number;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'log';
      timestamp: string;
      level?: 'info' | 'warn' | 'error' | 'debug';
      message: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'token';
      timestamp: string;
      text: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'tool';
      timestamp: string;
      toolName: string;
      toolPhase?: 'request' | 'start' | 'result' | 'error' | 'denied';
      message?: string;
      toolDenial?: ToolDenialEvent;
      toolResult?: ToolRuntimePayloadEvent;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'question';
      timestamp: string;
      questionType?: 'confirm' | 'input' | 'select' | 'password' | 'checklist';
      message: string;
      choices?: QuestionSelectChoice[];
      default?: string | boolean | string[];
      recommended?: string[];
      minSelections?: number;
      maxSelections?: number;
      allowOther?: boolean;
      otherLabel?: string;
      otherPrompt?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'handoff';
      timestamp: string;
      fromAgentId: string;
      fromAgentName?: string;
      fromAgentRole?: string;
      fromSessionId?: string;
      toAgentId: string;
      toAgentName?: string;
      toAgentRole?: string;
      toSessionId?: string;
      handoffNote?: string;
      briefingContent?: string;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'code_edit_proposal';
      timestamp: string;
      proposalId?: string;
      agentName?: string;
      description?: string;
      filesChanged?: number;
      additions?: number;
      deletions?: number;
      warnings?: string[];
      files?: Array<{
        filePath: string;
        oldContent: string;
        newContent: string;
        additions?: number;
        deletions?: number;
      }>;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'result';
      timestamp: string;
      data: AiTeamCommandResponseMap[TCommand];
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'error';
      timestamp: string;
      message: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'done' | 'aborted';
      timestamp: string;
    };

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
  question?: QuestionRequest;
  completed?: boolean;
  result?: unknown;
  error?: string;
}

// ─── Mediator runtime types ───────────────────────────────────────────────────

export interface WorkflowStateSnapshot {
  workflowId: string;
  continuationToken?: string;
  answers: Record<string, QuestionAnswerValue>;
}

export interface MediatorContext {
  signal?: AbortSignal;
  emit?: (event: MediatorRuntimeEvent) => void;
  questionInput?: (request: QuestionInputRequest) => Promise<string>;
  questionConfirm?: (request: QuestionConfirmRequest) => Promise<boolean>;
  questionSelect?: (request: QuestionSelectRequest) => Promise<string>;
  questionPassword?: (request: QuestionPasswordRequest) => Promise<string>;
  questionChecklist?: (request: QuestionChecklistRequest) => Promise<string[]>;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
  logger?: (entry: { channel: 'runtime' | 'stream'; event: unknown }) => void;
}

// ─── Question / workflow types ────────────────────────────────────────────────

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

export type QuestionRequest =
  | ({ kind: 'input' } & QuestionInputRequest)
  | ({ kind: 'confirm' } & QuestionConfirmRequest)
  | ({ kind: 'password' } & QuestionPasswordRequest)
  | ({ kind: 'select' } & QuestionSelectRequest)
  | ({ kind: 'checklist' } & QuestionChecklistRequest);

export type QuestionAnswerValue = string | boolean | number | string[] | Record<string, string>;

export interface CreateAgentSetupInput {
  kind: 'agent';
  name: string;
  role: string;
  contextLevel: ContextLevel;
  reportsTo?: string;
  features?: string[];
  llm?: LlmProfile;
}

export interface AiTeamCommandResponseMap {
  listEmployees: Agent[];
  resolveEmployees: Agent[];
  getTeamGraph: GraphData;
  getOrganizationGraph: GraphData;
  create: void;
  chat: void;
  hire: void;
  fire: void;
  init: void;
  hhRefresh: void;
  providerConfigure: void;
  providerAdd: void;
  providerSet: void;
  providerList: void;
  providerModels: void;
  providerModelsRefresh: void;
  testConnection: void;
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

export interface IAiTeamMediator {
  streamChat<TCommand extends AiTeamCommandName>(
    agentId: string,
    message: string,
    options: Omit<WebSocketStreamOptions, 'url'> & { sessionId?: string }
  ): AsyncIterable<MediatorEvent<TCommand>>;

  invokeTool<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context?: MediatorContext
  ): Promise<AiTeamCommandResponseMap[TCommand]>;

  streamInteraction<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context?: MediatorContext
  ): AsyncIterable<MediatorEvent<TCommand>>;
}
