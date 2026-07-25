import type {
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
  CommandAvailability,
  CommandResponse,
} from './command-types.js';
import type { Agent, Skill, PermissionConfig } from './agent-models.js';
import type {
  Artifact,
  ChatMessage,
  ChatSession,
  LlmInvocationMetadata,
} from './communication.js';
import type { LlmConfig, SkillConfig, TeamConfig } from './schemas.js';
import type { StructuredToolResult } from './tool-results.js';
import type {
  SessionSkill,
  MessageSessionLink,
  SessionDeleteImpact,
} from '../storage/contracts.js';
import type {
  IEmitService,
  ToolDenialEvent,
  ToolRuntimePayloadEvent,
} from './interaction-services.js';

export interface IChatSkillService {
  resolveSkillsForTurnAsync(params: {
    userMessage: string;
    ctx: ExecutionContext;
  }): Promise<{ skills: Skill[]; missingSkillNames: string[] }>;
}

export interface IToolDispatchService {
  dispatch(
    call: ILlmToolCall,
    ctx: ExecutionContext,
    contextFiles?: string[]
  ): Promise<{
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
    structured?: StructuredToolResult;
    terminal?: boolean;
  }>;
}

export interface ILlmInvokeParams {
  messages: ILlmChatMessageParam[];
  tools: ICommand[];
  toolDefs: ILlmToolDefinition[];
  skills: Skill[];
  teamRoster: Agent[];
  ctx: ExecutionContext;
}

export interface ILlmInvokeResult {
  fullResponse: string;
  structuredResults: StructuredToolResult[];
  metrics: LlmInvocationMetadata;
}

export interface ILlmInvokeService {
  invokeAsync(params: ILlmInvokeParams): Promise<ILlmInvokeResult>;
}

export interface ISendTurnStepService<
  TPlugins = unknown,
  TResolved = unknown,
  TTurnResult extends { text: string; done?: boolean } = { text: string; done?: boolean },
> {
  ensureTurnStartAsync(): Promise<void>;
  persistUserMessageAsync(userMessage: string, ctx: ExecutionContext): Promise<ChatMessage>;
  prepareMessagesAsync(
    userMessage: string,
    plugins: TPlugins,
    ctx: ExecutionContext,
    options?: { internalInstruction?: string }
  ): Promise<ILlmChatMessageParam[]>;
  resolveSkillsAndToolsAsync(
    userMessage: string,
    plugins: TPlugins,
    ctx: ExecutionContext
  ): Promise<TResolved>;
  invokeTurnLlmAsync(
    messages: ILlmChatMessageParam[],
    resolved: TResolved,
    ctx: ExecutionContext
  ): Promise<ILlmInvokeResult>;
  persistAssistantMessageAsync(
    fullResponse: string,
    ctx: ExecutionContext,
    llmMetadata?: LlmInvocationMetadata
  ): Promise<{ persistedMessage: ChatMessage; persistedContent: string }>;
  parseTurnResultAsync(
    structuredResults: StructuredToolResult[],
    fullResponse: string,
    persistedContent: string,
    plugins: TPlugins,
    ctx: ExecutionContext
  ): Promise<TTurnResult | null>;
  finalizeTurnResultAsync(
    result: TTurnResult,
    plugins: TPlugins,
    ctx: ExecutionContext
  ): Promise<TTurnResult>;
  handleLlmFailureAsync(
    error: unknown,
    plugins: TPlugins,
    ctx: ExecutionContext,
    options?: { archiveFailure?: boolean }
  ): Promise<TTurnResult>;
}

export type ChatTurnBootstrapResolution =
  | {
      ok: true;
      agent: Agent;
      sessionId: string;
      /** Private LLM context for this one agent session; never a thread transcript. */
      sessionHistory: ChatMessage[];
      developerId: string;
    }
  | {
      ok: false;
      message: string;
    };

export interface IChatTurnBootstrapResolver {
  resolveAsync(
    input: {
      agentQuery?: string;
      sessionId?: string;
      createNewSession?: boolean;
    },
    ctx: ExecutionContext
  ): Promise<ChatTurnBootstrapResolution>;
  updateCachedRuntimeState(
    ctx: ExecutionContext,
    state: {
      agentId: string;
      sessionId: string;
      history: ChatMessage[];
      navStack: ExecutionContext['navStack'];
    }
  ): void;
}

export interface ISessionManager {
  // ── Session CRUD ──────────────────────────────────────────────────────────
  createSession(agentQuery: string, developerId: string): Promise<ChatSession>;
  createHandoffSession(
    agentQuery: string,
    developerId: string,
    previousSessionId: string,
    transferArtifacts?: boolean,
    transferAllowedFiles?: boolean
  ): Promise<ChatSession>;
  getLatestSession(agentQuery: string): Promise<ChatSession | null>;
  getOrCreateLatestSession(agentId: string, developerId: string): Promise<ChatSession>;
  getSession(sessionId: string): Promise<ChatSession | null>;
  saveSession(session: ChatSession): Promise<void>;
  resolveLatestSessionForResume(developerId?: string): Promise<ChatSession | null>;
  listRecentSessions(limit?: number, developerId?: string): Promise<ChatSession[]>;
  listSessions(agentQuery: string, limit?: number): Promise<ChatSession[]>;
  getSessionDeleteImpact(sessionId: string): Promise<SessionDeleteImpact>;
  deleteSession(sessionId: string, options?: unknown): Promise<void>;
  addAgentToSession(sessionId: string, agentId: string): Promise<ChatSession>;

  // ── Message CRUD ──────────────────────────────────────────────────────────
  getSessionMessages(sessionId: string): Promise<ChatMessage[]>;
  listSessionMessages(sessionId: string): Promise<ChatMessage[]>;
  getMessageById(messageId: number): Promise<ChatMessage | null>;
  appendMessage(
    sessionId: string,
    message: ChatMessage,
    llmService?: unknown
  ): Promise<string | null>;
  deleteSessionMessage(sessionId: string, timestamp: string): Promise<boolean>;
  setMessageHiddenFromLlm(messageId: number, hidden: boolean): Promise<boolean>;
  updateMessageContent(messageId: number, newContent: string): Promise<boolean>;
  updateToolCallLlmResult(toolCallId: number, newText: string): Promise<void>;
  /** Persist an invocation before execution. Implementations may omit this for legacy storage. */
  appendToolCallRequest?(
    sessionId: string,
    message: ChatMessage
  ): Promise<void>;
  /** Persist a completion independently from its invocation. */
  appendToolCallResult?(
    sessionId: string,
    callId: string,
    result: unknown,
    resultLlm: string | undefined,
    phase: 'result' | 'error' | 'denied',
    timestamp: string
  ): Promise<void>;

  // ── Message ↔ Session Links ───────────────────────────────────────────────
  createMessageSessionLink(messageId: number, sessionId: string): Promise<MessageSessionLink>;
  listMessageSessionLinks(sessionId: string): Promise<MessageSessionLink[]>;
  deleteMessageSessionLink(messageId: number, sessionId: string): Promise<boolean>;

  // ── Session Skills ────────────────────────────────────────────────────────
  addSessionSkill(sessionId: string, skillPath: string): Promise<void>;
  setSessionSkillPaused(sessionId: string, skillPath: string, paused: boolean): Promise<void>;
  getSessionSkills(sessionId: string): Promise<SessionSkill[]>;

  // ── Artifacts ─────────────────────────────────────────────────────────────
  createArtifact(
    sessionId: string,
    fromIndex: number,
    toIndex: number,
    summary: string,
    title: string,
    developerId: string
  ): Promise<Artifact>;
  listArtifacts(): Promise<Artifact[]>;
  getArtifact(artifactId: string): Promise<Artifact | null>;
}

export interface IChatStorage {
  getMessagesAsync(agentId: string): Promise<ChatMessage[]>;
  appendMessageAsync(agentId: string, message: ChatMessage): Promise<void>;
  overwriteMessagesAsync(agentId: string, messages: ChatMessage[]): Promise<void>;
  clearMessagesAsync(agentId: string): Promise<void>;
  archiveMessageAsync(agentId: string, messageIndex: number): Promise<void>;
}

export interface IPathPermissionChecker {
  can(
    right: 'read' | 'write' | 'list',
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean;
  canReadPath(permissions: PermissionConfig | undefined, filePath: string): boolean;
  canWritePath(permissions: PermissionConfig | undefined, filePath: string): boolean;
  canListPath(permissions: PermissionConfig | undefined, filePath: string): boolean;
  assertCanReadPath(
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void;
  assertCanWritePath(
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void;
}

export interface ILlmChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
  stream?: boolean;
}

export interface ILlmToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  group?: string;
}

export interface ILlmToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ILlmToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  /** A terminal orchestration action (for example a handoff) ends this tool loop. */
  terminal?: boolean;
}

export interface ILlmToolChatResult {
  text: string;
  toolResults: ILlmToolResult[];
}

export interface ILlmChatMessageParam {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface ILlmService {
  initialize(): Promise<void>;
  ensureInitialized(): Promise<void>;
  initializeForChat(
    agent?: Pick<Agent, 'llm'>,
    skill?: Pick<Skill, 'llm'>,
    runtimeOverrides?: ILlmChatOptions
  ): Promise<ILlmChatOptions>;
  chat(
    agent: Agent,
    messages: ILlmChatMessageParam[],
    options?: ILlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[]
  ): Promise<string>;
  rawChat(
    systemPrompt: string,
    messages: ILlmChatMessageParam[],
    options?: ILlmChatOptions
  ): Promise<string>;
}

export interface ISkillManager {
  refreshAsync(): Promise<void>;
  getAllSkillsAsync(): Promise<Skill[]>;
  getSkillAsync(name: string): Promise<Skill | undefined>;
  createSkillAsync(config: SkillConfig): Promise<Skill>;
  updateSkillAsync(name: string, updates: Partial<SkillConfig>): Promise<Skill>;
}

export interface ICodeEditManager {
  listProposals(): Array<{ id: string; status: string }>;
  getProposal(proposalId: string): unknown;
  markAccepted(proposalId: string, reviewer: string): unknown;
  markRejected(proposalId: string, reviewer: string, reason: string): unknown;
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  toolName: string;
  result?: unknown;
  error?: string;
}

export interface IToolManager {
  register(tool: ICommand): void;
  get(name: string): ICommand | undefined;
  getAll(): ICommandDescriptor[];
  getForAgent(agent: Agent): ICommand[];
  list(): ICommandDescriptor[];
  toSchema(agent: Agent): ILlmToolDefinition[];
  toSchema(toolName: string): ILlmToolDefinition | undefined;
  canExecute(agent: Agent, toolName: string, params: unknown): Promise<PermissionResult>;
  execute(
    agent: Agent,
    toolName: string,
    params: unknown,
    context: ExecutionContext,
    options?: { timeoutMs?: number }
  ): Promise<ToolExecutionResult>;
}

export interface IToolSerializationService {
  formatArgs(args: unknown): string;
  formatToolResultPreview(outputText: string): string;
  serialise(value: unknown): string;
  isLikelyJsonDocument(value: string): boolean;
  serializeForStorage(value: unknown): string | undefined;
}

export interface IToolSchemaService {
  getToolSchema(tool: ICommand): ILlmToolDefinition;
  buildToolDefinitions(tools: ICommand[]): ILlmToolDefinition[];
  buildToolDefinitionsFromDescriptors(
    descriptors: Array<Pick<ICommandDescriptor, 'key' | 'group' | 'description'>>
  ): ILlmToolDefinition[];
}

export interface IToolDispatchSupportService {
  formatArgs(args: unknown): string;
  serialise(value: unknown): string;
  formatToolResultPreview(outputText: string): string;
  getWorkspaceRoot(): string;
  requiresConfirmation(toolName: string): boolean;
  toToolDenialEvent(denial: {
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
  }): ToolDenialEvent;
  extractFileChanges(
    result: unknown
  ): Array<{ filePath: string; oldContent: string; newContent: string }>;
  stripFileChanges(result: unknown): unknown;
  buildToolRuntimePayload(
    toolName: string,
    outcome: ToolRuntimePayloadEvent['outcome'],
    request: unknown,
    commandResponse: CommandResponse | undefined,
    denial?: {
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
    },
    resultLlm?: string,
    fileChanges?: Array<{ filePath: string; oldContent: string; newContent: string }>
  ): ToolRuntimePayloadEvent;
  buildPendingToolRuntimePayload(
    toolName: string,
    phase: 'request' | 'start',
    request: unknown,
    longRunning?: boolean
  ): ToolRuntimePayloadEvent;
  buildToolCommandResponse(
    toolName: string,
    message: string,
    result: unknown,
    denial?: {
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
  ): CommandResponse;
  classifyToolDenial(
    ok: boolean,
    result: unknown,
    message: string
  ):
    | {
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
    | undefined;
  prepareToolOutputForHistory(
    ctx: ExecutionContext,
    toolName: string,
    output: string
  ): Promise<{ output: string; filtered: boolean; label?: string }>;
  persistCodeEditProposal(
    result: unknown,
    args: unknown,
    ctx: ExecutionContext,
    emitService: IEmitService
  ): Promise<void>;
}

export interface IContextService {
  getContextEstimate(agentId: string, query?: { sessionId?: string }): Promise<unknown>;
}

export interface ICommandDispatcher {
  dispatch(
    key: string,
    params: unknown,
    ctx: ExecutionContext
  ): Promise<{
    status: 'ok' | 'error' | 'cancelled';
    message: string;
    data?: unknown;
    error?: { code?: string; details?: unknown };
  }>;
  getCommands(filter?: Partial<CommandAvailability>): ICommandDescriptor[];
  getCommand(key: string): ICommandDescriptor | undefined;
}

export type WorkflowHandleStatus = 'active' | 'completed' | 'cancelled' | 'failed';

export interface WorkflowRunnerStartOptions {
  signal?: AbortSignal;
  executionContext?: ExecutionContext;
  commands?: Record<string, { execute(params: unknown, ctx?: unknown): Promise<unknown> }>;
}

export interface WorkflowRunResult<TState> {
  state: TState;
  aborted: boolean;
}

export interface WorkflowSnapshotView<TState> {
  state: TState;
  aborted: boolean;
  stepId?: string;
}

export interface IWorkflowRunner {
  start<TState>(
    definition: unknown,
    initialState: TState,
    options?: WorkflowRunnerStartOptions
  ): Promise<IWorkflowRunHandle<TState>>;

  run<TState>(
    definition: unknown,
    initialState: TState,
    options?: WorkflowRunnerStartOptions
  ): Promise<WorkflowRunResult<TState>>;
}

/**
 * A command invocation after workflow-owned inputs and execution context have
 * been resolved. It deliberately contains no actor or service implementation.
 */
export interface PreparedCommandInvocation {
  commandKey: string;
  params: unknown;
  context: ExecutionContext;
  /** Stable across restore/retry for one workflow step invocation. */
  idempotencyKey: string;
}

export interface IWorkflowRunHandle<
  TState,
  TEvent = unknown,
  TPersistedSnapshot = unknown,
  TSnapshotView extends WorkflowSnapshotView<TState> = WorkflowSnapshotView<TState>,
> {
  readonly id: string;
  getStatus(): WorkflowHandleStatus;
  getSnapshotView(): TSnapshotView;
  getPersistedSnapshot(): TPersistedSnapshot;
  dispatch(event: TEvent): Promise<void>;
  checkpoint(): Promise<unknown>;
  cancel(): Promise<void>;
  waitForDone(): Promise<WorkflowRunResult<TState>>;
}

export interface IWorkflowRunnerFactory {
  create(): IWorkflowRunner;
  asCommand(definition: unknown): ICommand;
}

export interface IChatRuntime {
  runAsync(input: unknown): Promise<{
    status: 'completed' | 'failed' | 'max_hops_reached';
    text: string;
    hopCount: number;
    error?: string;
  }>;
}

export interface IContextCompressor<Ctx = unknown> {
  compress(history: ChatMessage[], ctx: Ctx): Promise<ChatMessage[]>;
}

export interface IContextBuilder<Ctx = unknown, TMessage = unknown> {
  build(history: ChatMessage[], ctx: Ctx): Promise<TMessage[]>;
}

export interface IContextEnricher<Ctx = unknown> {
  readonly name: string;
  enrich(ctx: Ctx): Promise<string | null>;
}

export interface IRagProvider<Ctx = unknown> {
  retrieve(query: string, ctx: Ctx): Promise<string | null>;
}

export interface IToolResolver<Ctx = unknown, TTool = ICommand> {
  resolve(ctx: Ctx): Promise<TTool[]>;
}

export interface IMcpGateway<TTool = ICommand> {
  discover(): Promise<TTool[]>;
}

export interface ILlmSelector<Ctx = unknown> {
  select(ctx: Ctx): Promise<void>;
}

export interface IOutputHandler<Ctx = unknown, TResult = unknown> {
  handle(result: TResult, ctx: Ctx): Promise<void>;
}

export interface ITurnResultParser<Ctx = unknown, TResult = unknown> {
  parse(
    structuredResults: StructuredToolResult[],
    fullResponse: string,
    persistedContent: string,
    ctx: Ctx
  ): Partial<TResult> | null;
}

export interface TurnStartHookPayload<Ctx = unknown> {
  userMessage: string;
  options?: { skipPersist?: boolean };
  ctx: Ctx;
}

export interface MessagesPreparedHookPayload<Ctx = unknown, TMessage = unknown> {
  messages: TMessage[];
  ctx: Ctx;
}

export interface SkillsResolvedHookPayload<Ctx = unknown> {
  skills: Skill[];
  missingSkillNames: string[];
  ctx: Ctx;
}

export interface ToolsResolvedHookPayload<Ctx = unknown, TTool = ICommand> {
  tools: TTool[];
  toolDefs: ILlmToolDefinition[];
  ctx: Ctx;
}

export interface BeforePersistAssistantMessageHookPayload<Ctx = unknown> {
  fullResponse: string;
  persistedContent: string;
  ctx: Ctx;
}

export interface AfterPersistAssistantMessageHookPayload<Ctx = unknown> {
  fullResponse: string;
  persistedContent: string;
  persistedMessage: ChatMessage;
  ctx: Ctx;
}

export interface TurnCompletedHookPayload<Ctx = unknown, TResult = unknown> {
  fullResponse: string;
  persistedContent: string;
  structuredResults: StructuredToolResult[];
  turnResult: TResult;
  ctx: Ctx;
}

export interface IOrchestratorHookPlugin<
  Ctx = unknown,
  TResult = unknown,
  TMessage = unknown,
  TTool = ICommand,
> {
  readonly name: string;
  onTurnStart?(payload: TurnStartHookPayload<Ctx>): Promise<void> | void;
  onMessagesPrepared?(payload: MessagesPreparedHookPayload<Ctx, TMessage>): Promise<void> | void;
  onSkillsResolved?(payload: SkillsResolvedHookPayload<Ctx>): Promise<void> | void;
  onToolsResolved?(payload: ToolsResolvedHookPayload<Ctx, TTool>): Promise<void> | void;
  onBeforePersistAssistantMessage?(
    payload: BeforePersistAssistantMessageHookPayload<Ctx>
  ): Promise<string | void> | string | void;
  onAfterPersistAssistantMessage?(
    payload: AfterPersistAssistantMessageHookPayload<Ctx>
  ): Promise<void> | void;
  onTurnCompleted?(payload: TurnCompletedHookPayload<Ctx, TResult>): Promise<void> | void;
}

export class Token<T> {
  declare readonly __type?: T;

  constructor(readonly id: string) {}

  toString(): string {
    return `Token(${this.id})`;
  }
}

/**
 * @deprecated Use Token<T> directly. Kept as compatibility alias during migration.
 */
export type IContainerToken<T> = Token<T>;

export type ContainerTokenValue<TToken extends Token<unknown>> =
  TToken extends Token<infer TValue> ? TValue : never;

export type ContainerTokenValueMap<TTokens extends Record<string, Token<unknown>>> = {
  [K in keyof TTokens]: ContainerTokenValue<TTokens[K]>;
};

/**
 * Narrow DI registration surface for package-local service wiring modules.
 *
 * Use this when a package only needs to register factories/instances and should
 * not depend on full resolve/read capabilities of the concrete container.
 */
export interface IServiceContainerRegistrar {
  register<T>(token: Token<T>, factory: (container: IServiceContainer) => T): this;
  registerSingleton<T>(token: Token<T>, factory: (container: IServiceContainer) => T): this;
  registerTransient<T>(token: Token<T>, factory: (container: IServiceContainer) => T): this;
  /** One instance per child container scope — each child creates its own singleton. */
  registerScoped<T>(token: Token<T>, factory: (container: IServiceContainer) => T): this;
  registerInstance<T>(token: Token<T>, instance: T): this;
}

export interface IServiceContainer extends IServiceContainerRegistrar {
  resolve<T>(token: Token<T>): T;
  tryResolve<T>(token: Token<T>): T | undefined;
  has(token: Token<unknown>): boolean;
  child(): IServiceContainer;
}

export interface DiscoveredModel {
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}

export interface IModelDiscoveryService {
  readonly kind: string;
  fetchModelsAsync(baseUrl?: string, apiKey?: string): Promise<DiscoveredModel[]>;
}

export interface IModelDiscoveryRegistry {
  getForKind(kind: string): IModelDiscoveryService | undefined;
}

export interface ILlmProviderTester {
  testConnectionAsync(config: TeamConfig, providerRef: string): Promise<void>;
  testLlmConnectionAsync(config: LlmConfig, apiKey?: string): Promise<string>;
}
