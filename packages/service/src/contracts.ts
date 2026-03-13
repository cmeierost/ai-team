import {
  Agent,
  AgentSearchOptions,
  AgentSearchResult,
  ContextLevel,
  GraphData,
  LlmConfig,
  LlmProfile,
  LlmProviderConfig,
  RoleType,
  ToolCatalogEntry,
  ViewMode,
} from '@ai-team/core';

export type Employee = Agent;

export interface ListEmployeesRequest {
  role?: string;
  feature?: string;
}

export interface SearchAgentsRequest extends AgentSearchOptions {}

export interface SearchAgentsResponse {
  results: AgentSearchResult[];
  totalCount: number;
}

export interface ProviderModelsOptions {
  provider?: string;
  json?: boolean;
}

export interface RefreshProviderModelsOptions {
  provider?: string;
}

export interface ProviderListOptions {
  json?: boolean;
}

export interface TestConnectionOptions {
  provider?: string;
  modelKey?: string;
  model?: string;
  all?: boolean;
  employee?: string;
}

export type AccessRight = 'read' | 'write' | 'create' | 'delete' | 'list';

export interface WhoHasAccessOptions {
  path: string;
  right?: AccessRight;
}

export interface AccessContextCandidate {
  contextId: string;
  label?: string;
}

export interface WhoHasAccessResponse {
  path: {
    input: string;
    absolute: string;
    relative: string;
  };
  right: AccessRight;
  contextIds: string[];
  contexts: AccessContextCandidate[];
  explanation: string;
}

export interface DoIHaveAccessOptions {
  path: string;
  right?: AccessRight;
  agent?: string;
}

export interface DoIHaveAccessResponse {
  path: {
    input: string;
    absolute: string;
    relative: string;
  };
  right: AccessRight;
  contextId: string;
  contextLabel?: string;
  selectedBy: 'explicit' | 'default-first-agent';
  allowed: boolean;
  allRights: AccessRight[];
  explanation: string;
  alternativeContexts: Array<{ contextId: string; allowedPaths: string[] }>;
  deniedByIgnore: boolean;
  blockedByPatterns: string[];
}

export interface SearchSkillsOptions {
  query?: string;
  agent?: string;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  type: string;
  contextLevel: string;
  tools: string[];
}

export interface AgentSkillAssignmentEntry extends SkillCatalogEntry {
  assignedToAgent?: boolean;
}

export interface SearchSkillsResponse {
  entries: AgentSkillAssignmentEntry[];
  timestamp: string;
  agent?: {
    id: string;
    name: string;
    role: string;
  };
}

export interface UpdateAgentSkillOptions {
  agent: string;
  skill: string;
}

export interface UpdateAgentSkillResponse {
  agent: {
    id: string;
    name: string;
    role: string;
  };
  skill: string;
  skills: string[];
  changed: boolean;
}

export interface ListToolsOptions {
  agent?: string;
}

export interface AgentToolPermissionEntry extends ToolCatalogEntry {
  allowedForAgent?: boolean;
  deniedReason?: string;
}

export interface ListToolsResponse {
  entries: AgentToolPermissionEntry[];
  timestamp: string;
  agent?: {
    id: string;
    name: string;
    role: string;
  };
}

export interface UpdateAgentToolOptions {
  agent: string;
  tool: string;
}

export interface UpdateAgentToolResponse {
  agent: {
    id: string;
    name: string;
    role: string;
  };
  tool: string;
  tools: string[];
  changed: boolean;
}

export interface GovernanceMutationOptions {
  requestedBy: string;
  approvedByUser: boolean;
}

export type PathMode = 'read' | 'write' | 'create' | 'delete';

export interface FilePatternCollections {
  readPaths: string[];
  writePaths: string[];
  createPaths: string[];
  deletePaths: string[];
}

export interface GetFilePatternsResponse {
  global: {
    allowPaths: string[];
  } & FilePatternCollections;
  agent?: {
    id: string;
  } & FilePatternCollections;
}

export interface UpdateGlobalPathOptions {
  path: string;
  mode?: PathMode;
}

export interface UpdateGlobalPathResponse {
  mode: PathMode;
  paths: string[];
}

export interface UpdateAgentPathOptions {
  agent: string;
  path: string;
  mode?: PathMode;
}

export interface UpdateAgentPathResponse {
  agent: {
    id: string;
    name: string;
    role: string;
  };
  mode: PathMode;
  paths: string[];
}

export interface CreateOptions {
  name?: string;
  role?: string;
  interactive?: boolean;
  setup?: CreateSetupInput;
}

export interface CreateAgentSetupInput {
  kind: 'agent';
  name: string;
  role: string;
  contextLevel: ContextLevel;
  reportsTo?: string;
  features?: string[];
  llm?: LlmProfile;
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

export interface ConfigureProviderOptions {
  fromInit?: boolean;
  keepCurrentDefault?: boolean;
  setup?: ProviderSetupInput;
}

export interface SetProviderOptions {
  fromInit?: boolean;
  keepCurrentDefault?: boolean;
  setup?: ProviderSetupInput;
}

export interface AddProviderOptions {
  makeDefault?: boolean;
  setup?: ProviderSetupInput;
}

export interface ProviderSetupInput {
  providerRef: string;
  providerConfig: LlmProviderConfig;
  legacyLlm: LlmConfig;
  apiKeyEnvVar?: string;
  apiKey?: string;
}

export interface ChatOptions {
  message?: string;
  context?: string[];
  oneShot?: boolean;
  
  // Session management
  sessionId?: string;  // Resume this specific session
  createNewSession?: boolean;  // Force create new session instead of resuming latest
  addAgentToSession?: string;  // Add another agent to this session (multi-agent mode)
  
  /** @deprecated No longer used. Messages are always persisted to SQLite via SessionManager. */
  skipPersistence?: boolean;

  /**
   * Introduction text already displayed by the client (e.g. web UI). When provided on an empty-history
   * session, the introduction is persisted (with importance: 'low') immediately before the first user
   * message, without triggering a second LLM call. Mutually exclusive with the CLI introduction flow.
   */
  pendingIntroduction?: string;
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

export interface WorkflowFrame {
  workflowId: string;
  stepId: string;
  continuationToken?: string;
  question?: QuestionRequest;
  completed?: boolean;
  result?: unknown;
  error?: string;
}

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
  logger?: (entry: {
    channel: 'runtime' | 'stream';
    event: unknown;
  }) => void;
}

/**
 * Runtime hooks passed from the surface layer (CLI, VS Code, Web) into chatCommand.
 * Equivalent to MediatorContext without the internal structured logger.
 */
export type ChatRuntimeHooks = Omit<MediatorContext, 'logger'>;

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
  outcome: 'result' | 'error' | 'denied';
  result?: unknown;
  denial?: ToolDenialEvent;
}

export interface MediatorRuntimeEvent {
  kind: 'status' | 'progress' | 'log' | 'token' | 'tool' | 'question' | 'code_edit_proposal' | 'handoff';
  phase?: string;
  message?: string;
  percent?: number;
  level?: 'info' | 'warn' | 'error' | 'debug';
  text?: string;
  toolName?: string;
  toolPhase?: 'request' | 'start' | 'result' | 'error' | 'denied';
  toolDenial?: ToolDenialEvent;
  toolResult?: ToolRuntimePayloadEvent;
  questionType?: 'confirm' | 'input' | 'select' | 'password' | 'checklist';
  choices?: QuestionSelectChoice[];
  default?: string | boolean | string[];
  recommended?: string[];
  minSelections?: number;
  maxSelections?: number;
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  // Code edit proposal fields
  proposalId?: string;
  agentName?: string;
  description?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  warnings?: string[];
  /** Full file changes — present when kind === 'code_edit_proposal' */
  files?: Array<{ filePath: string; oldContent: string; newContent: string; additions?: number; deletions?: number }>;
  // Handoff fields
  fromAgentId?: string;
  fromAgentName?: string;
  fromSessionId?: string;
  toAgentId?: string;
  toAgentName?: string;
  toSessionId?: string;
  handoffNote?: string;
  /** LLM-generated briefing written in the FROM agent's voice */
  briefingContent?: string;
}

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

export interface AiTeamCommandResponseMap {
  listEmployees: Employee[];
  resolveEmployees: Employee[];
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

export interface MediatorRequest<TCommand extends AiTeamCommandName = AiTeamCommandName> {
  requestId?: string;
  command: TCommand;
  payload: AiTeamCommandPayloadMap[TCommand];
}

export type MediatorEvent<TCommand extends AiTeamCommandName = AiTeamCommandName> =
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
      fromSessionId?: string;
      toAgentId: string;
      toAgentName?: string;
      toSessionId?: string;
      handoffNote?: string;
      briefingContent?: string;
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

export interface AiTeamMediator {
  invoke<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context?: MediatorContext,
  ): Promise<AiTeamCommandResponseMap[TCommand]>;
  stream<TCommand extends AiTeamCommandName>(
    request: MediatorRequest<TCommand>,
    context?: MediatorContext,
  ): AsyncIterable<MediatorEvent<TCommand>>;
}

export interface AiTeamService extends AiTeamMediator {
  readonly workspaceRoot: string;
  listEmployees(request: ListEmployeesRequest): Promise<Employee[]>;
  resolveEmployees(query: string): Promise<Employee[]>;
  searchAgents(request: SearchAgentsRequest): Promise<SearchAgentsResponse>;
  searchSkills(options?: SearchSkillsOptions): Promise<SearchSkillsResponse>;
  addSkill(options: UpdateAgentSkillOptions): Promise<UpdateAgentSkillResponse>;
  removeSkill(options: UpdateAgentSkillOptions): Promise<UpdateAgentSkillResponse>;
  listTools(options?: ListToolsOptions): Promise<ListToolsResponse>;
  allowTool(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse>;
  disallowTool(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse>;
  toolAllow(options: UpdateAgentToolOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentToolResponse>;
  toolDeny(options: UpdateAgentToolOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentToolResponse>;
  accessAllow(options: UpdateAgentPathOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentPathResponse>;
  accessDeny(options: UpdateAgentPathOptions, governance: GovernanceMutationOptions): Promise<UpdateAgentPathResponse>;
  getTeamGraph(mode?: ViewMode): Promise<GraphData>;
  getOrganizationGraph(): Promise<GraphData>;
  create(type: string, options: CreateOptions): Promise<void>;
  chat(employeeId: string | undefined, options: ChatOptions): Promise<void>;
  hire(options: HireOptions): Promise<void>;
  fire(employeeQuery: string, options: FireOptions): Promise<void>;
  init(options: InitOptions): Promise<void>;
  hhRefresh(): Promise<void>;
  providerConfigure(options?: ConfigureProviderOptions): Promise<void>;
  providerAdd(options?: AddProviderOptions): Promise<void>;
  providerSet(options?: SetProviderOptions): Promise<void>;
  providerList(options?: ProviderListOptions): Promise<void>;
  providerModels(options: ProviderModelsOptions): Promise<void>;
  providerModelsRefresh(options: RefreshProviderModelsOptions): Promise<void>;
  testConnection(options?: TestConnectionOptions): Promise<void>;
  whoHasAccess(options: WhoHasAccessOptions): Promise<WhoHasAccessResponse>;
  doIHaveAccess(options: DoIHaveAccessOptions): Promise<DoIHaveAccessResponse>;
}
