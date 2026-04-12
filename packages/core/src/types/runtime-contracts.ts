import type { ToolContext as BaseToolContext, AgentTool as BaseAgentTool } from './tool-types.js';
import type { Agent, Skill } from './agent-models.js';
import type { ChatMessage } from './communication.js';
import type { GraphData } from './graph.js';
import type { SkillConfig } from './schemas.js';
import type { StructuredToolResult } from './tool-results.js';
import type { ViewMode } from './taxonomy.js';

export interface ITeamGraphBuilder {
  buildGraphDataAsync(viewMode?: ViewMode): Promise<GraphData>;
}

export interface IChatStorage {
  getMessagesAsync(agentId: string): Promise<ChatMessage[]>;
  appendMessageAsync(agentId: string, message: ChatMessage): Promise<void>;
  overwriteMessagesAsync(agentId: string, messages: ChatMessage[]): Promise<void>;
  clearMessagesAsync(agentId: string): Promise<void>;
}

export interface IChatManager {
  getHistoryAsync(agentId: string): Promise<ChatMessage[]>;
  appendMessageAsync(agentId: string, message: ChatMessage): Promise<void>;
  archiveMessageAsync(agentId: string, messageIndex: number): Promise<void>;
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
}

export interface ILlmService {
  initialize(): Promise<void>;
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

export interface ToolContext extends BaseToolContext {
  agent: Agent;
  currentFiles?: string[];
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

export interface AgentTool extends BaseAgentTool<ToolContext> {}

export interface IToolManager {
  register(tool: AgentTool): void;
  list(): AgentTool[];
  canExecute(agent: Agent, toolName: string, params: unknown): Promise<PermissionResult>;
  execute(agent: Agent, toolName: string, params: unknown): Promise<unknown>;
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

export interface IToolResolver<Ctx = unknown, TTool = AgentTool> {
  resolve(ctx: Ctx): Promise<TTool[]>;
}

export interface IMcpGateway<TTool = AgentTool> {
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

export interface ISlashCommand<Ctx = unknown> {
  readonly key: string;
  readonly aliases?: string[];
  readonly description: string;
  readonly usage?: string;
  readonly llmCallable?: boolean;
  execute(rawArgs: string, ctx: Ctx): Promise<void>;
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

export interface ToolsResolvedHookPayload<Ctx = unknown, TTool = AgentTool> {
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
  TTool = AgentTool,
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

export interface IContainerToken<T> {
  readonly id: string;
  toString(): string;
  readonly __type?: T;
}

export type ContainerTokenValue<TToken extends IContainerToken<unknown>> =
  TToken extends IContainerToken<infer TValue> ? TValue : never;

export type ContainerTokenValueMap<TTokens extends Record<string, IContainerToken<unknown>>> = {
  [K in keyof TTokens]: ContainerTokenValue<TTokens[K]>;
};

export interface IServiceContainer {
  register<T>(token: IContainerToken<T>, factory: (container: IServiceContainer) => T): this;
  registerSingleton<T>(
    token: IContainerToken<T>,
    factory: (container: IServiceContainer) => T
  ): this;
  registerTransient<T>(
    token: IContainerToken<T>,
    factory: (container: IServiceContainer) => T
  ): this;
  registerInstance<T>(token: IContainerToken<T>, instance: T): this;
  resolve<T>(token: IContainerToken<T>): T;
  tryResolve<T>(token: IContainerToken<T>): T | undefined;
  has(token: IContainerToken<unknown>): boolean;
  child(): IServiceContainer;
}
