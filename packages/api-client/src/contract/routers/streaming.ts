import {
  DoIHavePermissionResponse,
  FilePermission,
  PermissionOverlapReport,
  WhoHasPermissionResponse,
} from './access';
import {
  Agent,
  ContextLevel,
  ListEmployeesRequest,
  RoleType,
  SearchAgentsResponse,
} from './agents';
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
import { SearchSkillsResponse, UpdateAgentSkillResponse } from './skills';
import { ListToolsResponse, UpdateAgentToolResponse } from './tools';

/**
 * Command names available for service-layer dispatch.
 *
 * Service commands are callable from CLI, chat, and tools depending on
 * their `availableIn` flags in the command registry.
 */
export type AiTeamCommandName =
  // ── Service commands (CLI + chat + tool) ──────────────────────────────────
  | 'listEmployees'
  | 'resolveEmployees'
  | 'getTeamGraph'
  | 'getOrganizationGraph'
  | 'create'
  | 'chat'
  | 'hire'
  | 'fire'
  | 'init'
  | 'setup'
  | 'onboard'
  | 'systemStatus'
  | 'hhRefresh'
  | 'providerConfigure'
  | 'providerAdd'
  | 'providerSet'
  | 'providerList'
  | 'providerModels'
  | 'providerModelsRefresh'
  | 'testConnection'
  | 'avatar'
  // ── Access commands ────────────────────────────────────────────────────────
  | 'accessWho'
  | 'accessCan'
  | 'accessOverlap'
  // ── Search & skills commands ────────────────────────────────────────────────
  | 'searchAgents'
  | 'skillsList'
  | 'skillsAdd'
  | 'skillsRemove'
  // ── Tools commands ───────────────────────────────────────────────────────
  | 'toolsList'
  | 'toolsAllow'
  | 'toolsDeny'
  // ── Files commands ───────────────────────────────────────────────────────
  | 'filesTree'
  | 'filesPatterns'
  | 'filesAllow'
  | 'filesDeny'
  // ── Utility commands ────────────────────────────────────────────────────────
  | 'systemInfo'
  | 'dbStatus'
  | 'dbMigrate'
  | 'codeEditList'
  | 'codeEditApprove'
  | 'codeEditReject'
  | 'codeEditApply'
  | 'patchApply'
  // ── Chat-only slash commands ──────────────────────────────────────────────
  | 'help'
  | 'who'
  | 'session'
  | 'new'
  | 'history'
  | 'portfolio'
  | 'info'
  | 'overview'
  | 'graph'
  | 'run'
  | 'tool'
  | 'back';

export type RuntimeStreamEvent =
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
    }
  | {
      kind: 'avatar-preview';
      agentId: string;
      agentName: string;
      previewPath: string;
      /** Base64-encoded image data for web clients that cannot access the file system */
      imageBase64?: string;
    }
  | {
      /** Emitted when a slash command switches the active session (e.g. /new). */
      kind: 'session_switched';
      sessionId: string;
    }
  | {
      /** Emitted when the session title is automatically generated. */
      kind: 'session_title_updated';
      sessionId: string;
      title: string;
    };

export interface AvatarOptions {
  agentQuery: string;
}

// ── Files command response types ─────────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  size?: number;
  modified?: string;
}

export interface FilesTreeResponse {
  workspaceRoot: string;
  tree?: FileTreeNode;
  /** Agent-scoped annotated file list (present when agent is specified) */
  agent?: { id: string; name: string; role: string };
  annotatedFiles?: Array<{ path: string; readable: boolean; writable: boolean }>;
  writeableFiles?: string[];
  readPatterns?: string[];
  writePatterns?: string[];
  maxDepth: number;
  includeHidden: boolean;
  ignoreGitignore: boolean;
}

export interface FilesPatternsResponse {
  global: { read: string[]; write: string[] };
  agent?: { id: string; name: string; role: string };
  agentPatterns?: { read: string[]; write: string[] };
}

// ── Utility command response types ───────────────────────────────────────────

export interface SystemInfoResponse {
  workspace: string;
  branch: string | null;
  package: { name: string | null; version: string | null; description: string | null } | null;
}

export interface DbStatusResponse {
  schemaVersion: number;
  totalSessions: number;
  totalMessages: number;
  storageSizeBytes?: number;
  dbPath: string;
}

export interface DbMigrateResponse {
  applied: number;
  schemaVersion: number;
}

export interface CodeEditProposalSummary {
  id: string;
  description: string;
  agentName: string;
  status: string;
  timestamp: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  files: string[];
}

export interface CodeEditListResponse {
  proposals: CodeEditProposalSummary[];
  stats: {
    total: number;
    pending: number;
    approved: number;
    applied: number;
    rejected: number;
    failed: number;
  };
}

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

export interface SetupOptions {
  /** Force re-setup even if LLM is already configured */
  force?: boolean;
}

export interface OnboardOptions {
  /** Template to use for onboarding */
  template?: string;
}

export interface SystemStatus {
  initialized: boolean;
  hasLlmConfig: boolean;
  hasAgents: boolean;
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
  setup: { options?: SetupOptions };
  onboard: { options?: OnboardOptions };
  systemStatus: Record<string, never>;
  hhRefresh: Record<string, never>;
  providerConfigure: { options?: ConfigureProviderOptions };
  providerAdd: { options?: AddProviderOptions };
  providerSet: { options?: SetProviderOptions };
  providerList: { options?: ProviderListOptions };
  providerModels: { options: ProviderModelsOptions };
  providerModelsRefresh: { options: RefreshProviderModelsOptions };
  testConnection: { options?: TestConnectionOptions };
  avatar: { options: AvatarOptions };
  // ── Access commands ────────────────────────────────────────────────────────
  accessWho: { path: string; right?: FilePermission };
  accessCan: { path: string; right?: FilePermission; agent?: string };
  accessOverlap: { mode?: 'files' | 'patterns'; right?: FilePermission; agent?: string };
  // ── Search & skills commands ────────────────────────────────────────────────
  searchAgents: {
    query?: string;
    role?: string | string[];
    type?: string | string[];
    status?: string | string[];
    feature?: string | string[];
    specialization?: string | string[];
    tool?: string | string[];
    reportsTo?: string;
    contextLevel?: string | string[];
  };
  skillsList: { query?: string; agent?: string };
  skillsAdd: { agent: string; skill: string };
  skillsRemove: { agent: string; skill: string };
  // ── Tools commands ───────────────────────────────────────────────────────
  toolsList: { agent?: string };
  toolsAllow: { agent: string; tool: string; requestedBy?: string; approvedByUser?: boolean };
  toolsDeny: { agent: string; tool: string; requestedBy?: string; approvedByUser?: boolean };
  // ── Files commands ───────────────────────────────────────────────────────
  filesTree: {
    agent?: string;
    depth?: number;
    all?: boolean;
    noGitignore?: boolean;
    writeable?: boolean;
  };
  filesPatterns: { agent?: string };
  filesAllow: {
    path: string;
    agent?: string;
    mode?: string;
    requestedBy?: string;
    approvedByUser?: boolean;
  };
  filesDeny: {
    path: string;
    agent?: string;
    mode?: string;
    requestedBy?: string;
    approvedByUser?: boolean;
  };
  // ── Utility commands ────────────────────────────────────────────────────────
  systemInfo: Record<string, never>;
  dbStatus: Record<string, never>;
  dbMigrate: Record<string, never>;
  codeEditList: { status?: string; agent?: string };
  codeEditApprove: { proposalId: string };
  codeEditReject: { proposalId: string; reason?: string };
  codeEditApply: { proposalId: string };
  patchApply: { file: string; changes: Array<{ line: number; content: string }> };
  // ── Chat-only slash commands ──────────────────────────────────────────────
  help: Record<string, never>;
  who: Record<string, never>;
  session: Record<string, never>;
  new: Record<string, never>;
  history: { limit?: number };
  portfolio: Record<string, never>;
  info: { query: string };
  overview: Record<string, never>;
  graph: Record<string, never>;
  run: { command: string };
  tool: { toolName: string; args?: unknown };
  back: Record<string, never>;
}

export interface InteractionRequest<
  TCommand extends keyof AiTeamCommandPayloadMap = keyof AiTeamCommandPayloadMap,
> {
  requestId?: string;
  command: TCommand;
  payload: AiTeamCommandPayloadMap[TCommand];
}

// ── Command Dispatcher ────────────────────────────────────────────────────────

/** Where a command is available. */
export interface CommandAvailability {
  cli?: boolean;
  chat?: boolean;
  tool?: boolean;
}

/** Read-only descriptor exposed by the dispatcher for discovery. */
export interface CommandDescriptor {
  key: AiTeamCommandName;
  aliases?: string[];
  description: string;
  usage?: string;
  availableIn: CommandAvailability;
}

/**
 * Service-layer command dispatch interface.
 *
 * Both CLI and browser clients delegate here to execute commands by typed
 * payload. Chat slash commands are also routed through this interface, making
 * every command callable as `{ command, payload }`.
 */
export interface ICommandDispatcher {
  dispatch<TCommand extends AiTeamCommandName>(
    request: InteractionRequest<TCommand>,
    context?: InteractionContext
  ): Promise<AiTeamCommandResponseMap[TCommand]>;

  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[];
  getCommand(key: AiTeamCommandName): CommandDescriptor | undefined;
}

export interface ToolRuntimePayloadEvent {
  toolName: string;
  outcome: 'result' | 'error' | 'denied';
  request?: unknown;
  result?: unknown;
  /** LLM-formatted representation of result — what was injected into the model's context window. */
  resultLlm?: unknown;
  denial?: ToolDenialEvent;
}

export type StreamEvent<
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
      kind: 'avatar-preview';
      timestamp: string;
      agentId: string;
      agentName: string;
      previewPath: string;
      imageBase64?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'session_switched';
      timestamp: string;
      sessionId: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'session_title_updated';
      timestamp: string;
      sessionId: string;
      title: string;
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
  /** Visual style for the confirmation prompt. 'allow' renders Allow/Deny buttons; 'confirm' (default) renders Yes/No buttons. */
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

export interface InteractionContext extends IQuestionContext {
  emit?: (event: RuntimeStreamEvent) => void;
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
  /** Visual style for the confirmation prompt. 'allow' renders Allow/Deny buttons; 'confirm' (default) renders Yes/No buttons. */
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
  setup: void;
  onboard: void;
  systemStatus: SystemStatus;
  hhRefresh: void;
  providerConfigure: void;
  providerAdd: void;
  providerSet: void;
  providerList: void;
  providerModels: void;
  providerModelsRefresh: void;
  testConnection: void;
  avatar: void;
  // ── Access commands ────────────────────────────────────────────────────────
  accessWho: WhoHasPermissionResponse;
  accessCan: DoIHavePermissionResponse;
  accessOverlap: PermissionOverlapReport;
  // ── Search & skills commands ────────────────────────────────────────────────
  searchAgents: SearchAgentsResponse;
  skillsList: SearchSkillsResponse;
  skillsAdd: UpdateAgentSkillResponse;
  skillsRemove: UpdateAgentSkillResponse;
  // ── Tools commands ───────────────────────────────────────────────────────
  toolsList: ListToolsResponse;
  toolsAllow: UpdateAgentToolResponse;
  toolsDeny: UpdateAgentToolResponse;
  // ── Files commands ───────────────────────────────────────────────────────
  filesTree: FilesTreeResponse;
  filesPatterns: FilesPatternsResponse;
  filesAllow: { paths: string[] };
  filesDeny: { paths: string[] };
  // ── Utility commands ────────────────────────────────────────────────────────
  systemInfo: SystemInfoResponse;
  dbStatus: DbStatusResponse;
  dbMigrate: DbMigrateResponse;
  codeEditList: CodeEditListResponse;
  codeEditApprove: { proposalId: string };
  codeEditReject: { proposalId: string };
  codeEditApply: { proposalId: string; files: string[] };
  patchApply: { proposalId: string; patchedLines: number };
  // ── Chat-only slash commands ──────────────────────────────────────────────
  help: void;
  who: void;
  session: void;
  new: void;
  history: void;
  portfolio: void;
  info: void;
  overview: void;
  graph: void;
  run: void;
  tool: void;
  back: void;
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

// ─── Streaming client (browser / transport) ───────────────────────────────────

/**
 * Map of question event names to their typed handler signatures.
 */
export type QuestionHandlerMap = {
  questionInput: (request: QuestionInputRequest) => Promise<string>;
  questionConfirm: (request: QuestionConfirmRequest) => Promise<boolean>;
  questionSelect: (request: QuestionSelectRequest) => Promise<string>;
  questionPassword: (request: QuestionPasswordRequest) => Promise<string>;
  questionChecklist: (request: QuestionChecklistRequest) => Promise<string[]>;
};

export type QuestionEventName = keyof QuestionHandlerMap;

/**
 * A stream of interaction events with typed `.on()` registration for
 * question handlers.
 *
 * Handlers registered via `.on()` are collected before iteration begins.
 * When the underlying transport encounters a question, it invokes the
 * matching handler.
 *
 * ```ts
 * const stream = client.stream(request)
 *   .on('questionInput', handler)
 *   .on('questionConfirm', handler);
 * for await (const event of stream) { ... }
 * ```
 */
export interface IInteractionStream<TCommand extends AiTeamCommandName> extends AsyncIterable<
  StreamEvent<TCommand>
> {
  on<K extends QuestionEventName>(event: K, handler: QuestionHandlerMap[K]): this;
}

/**
 * @deprecated Use {@link IInteractionStream} `.on()` registration instead.
 *
 * Legacy context passed by the browser client when starting a stream.
 */
export interface IQuestionContext {
  signal?: AbortSignal;
  questionInput?: (request: QuestionInputRequest) => Promise<string>;
  questionConfirm?: (request: QuestionConfirmRequest) => Promise<boolean>;
  questionSelect?: (request: QuestionSelectRequest) => Promise<string>;
  questionPassword?: (request: QuestionPasswordRequest) => Promise<string>;
  questionChecklist?: (request: QuestionChecklistRequest) => Promise<string[]>;
}

/**
 * Transport-level streaming client for the browser.
 *
 * Connects to the API server over WebSocket and yields streaming events.
 * This is NOT a service interface — it's a transport adapter consumed by the
 * web frontend.
 */
export interface IStreamingClient {
  stream<TCommand extends AiTeamCommandName>(
    request: InteractionRequest<TCommand>,
    options?: { signal?: AbortSignal }
  ): IInteractionStream<TCommand>;
}
