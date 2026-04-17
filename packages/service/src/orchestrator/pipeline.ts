/**
 * Pipeline interfaces — the complete extension surface for the chat orchestrator.
 *
 * OPEN/CLOSED PRINCIPLE: Every extension seam is defined here as an interface.
 * The orchestrator calls these interfaces. New capabilities are added by:
 *   1. Implementing the interface
 *   2. Passing it to ChatOrchestrator({ plugins: { … } })
 * No orchestrator code changes required.
 *
 * Default implementations live in orchestrator/defaults/.
 * Stub implementations (NoOp*) satisfy every interface so the orchestrator
 * is always fully-wired — even before a feature is built.
 */

import type {
  AgentTool,
  ChatCompletionMessageParam,
  ChatMessage,
  Skill,
  StructuredToolResult,
} from '@ai-team/infrastructure';
import type { LlmToolDefinition } from '../tools/tool-manager.js';
import type { OrchestratorContext } from './pipeline-context.js';

// ── 1. Context Compression ────────────────────────────────────────────────────

/**
 * Called when the message history approaches the model's context window limit.
 * Decides what to keep, summarize, or discard before the next LLM call.
 *
 * Default: NoOpCompressor — returns history unchanged.
 * Future: summarize oldest N messages, or apply importance-weighted pruning.
 */
export interface IContextCompressor {
  compress(history: ChatMessage[], ctx: OrchestratorContext): Promise<ChatMessage[]>;
}

// ── 2. Context Builder ────────────────────────────────────────────────────────

/**
 * Assembles the final ChatCompletionMessageParam[] array sent to the LLM.
 * Receives the (optionally compressed) history and returns the formatted messages
 * including system prompt and importance-filtered history.
 *
 * Default: DefaultContextBuilder — LlmService.historyToMessages() + system prompt.
 * Future: inject RAG results, apply per-agent formatting rules.
 */
export interface IContextBuilder {
  build(history: ChatMessage[], ctx: OrchestratorContext): Promise<ChatCompletionMessageParam[]>;
}

// ── 3. Context Enricher ───────────────────────────────────────────────────────

/**
 * Role-aware context injections appended as system messages before the LLM call.
 * Multiple enrichers run sequentially; each returns its payload or null (skip).
 * The orchestrator concatenates non-null results into a single system injection.
 *
 * Default impls: WorkspaceOverviewEnricher (architect/leadership roles),
 *                TeamRosterEnricher (HR role).
 * Future: project status summaries, recent incident reports, etc.
 */
export interface IContextEnricher {
  /** Short label used in logs and diagnostics, e.g. "workspace-overview". */
  readonly name: string;
  enrich(ctx: OrchestratorContext): Promise<string | null>;
}

// ── 4. RAG Provider ───────────────────────────────────────────────────────────

/**
 * Retrieval-Augmented Generation: inject relevant file/document content
 * for the current user query.
 *
 * IMPORTANT: Implementations MUST scope retrieval to the agent's readable files.
 * Use contextManager.getReadablePaths(agent) as the retrieval scope.
 * Returning content from files the agent cannot read is a permission violation.
 *
 * Default: NoOpRagProvider — returns null (no retrieval).
 * Future: embedding-based retrieval over allowed file index.
 */
export interface IRagProvider {
  retrieve(query: string, ctx: OrchestratorContext): Promise<string | null>;
}

// ── 5. Tool Resolver ──────────────────────────────────────────────────────────

/**
 * Determines which tools are available to the agent for the current turn.
 * The resolved list is passed to the LLM as the `tools` array.
 *
 * Default: DefaultToolResolver — toolManager.getForAgent(agent).
 * Future: dynamic permission re-evaluation, feature-flag-gated tools.
 */
export interface IToolResolver {
  resolve(ctx: OrchestratorContext): Promise<AgentTool[]>;
}

// ── 6. MCP Gateway ───────────────────────────────────────────────────────────

/**
 * Discovers and exposes tools from external Model Context Protocol servers.
 * Discovered tools are merged with the local tool list each turn.
 *
 * Default: NoOpMcpGateway — returns [] (no external servers).
 * Future: MCP server discovery, authentication, and tool proxying.
 */
export interface IMcpGateway {
  discover(): Promise<AgentTool[]>;
}

// ── 7. LLM Selector ──────────────────────────────────────────────────────────

/**
 * Selects and initializes the LLM model/provider for the current turn.
 * May mutate ctx.llmService or switch the underlying model.
 *
 * Default: DefaultLlmSelector — llmService.initializeForChat(agent, skill).
 * Future: cost-based routing, A/B testing, model cascade fallback.
 */
export interface ILlmSelector {
  select(ctx: OrchestratorContext): Promise<void>;
}

// ── 8. Output Handler ─────────────────────────────────────────────────────────

/**
 * Persists turn results and emits runtime events to connected surfaces.
 * Called once per completed LLM turn (including tool resolution).
 *
 * Default: DefaultOutputHandler — persist to SessionManager, emit via hooks.emit.
 * Future: distributed event bus, audit logging, analytics.
 */
export interface IOutputHandler {
  handle(result: TurnResult, ctx: OrchestratorContext): Promise<void>;
}

// ── 9. Turn Result Parser ───────────────────────────────────────────────────

/**
 * Interprets the raw outputs of a completed LLM turn (structured tool results
 * and the full response text) into a concrete TurnResult override.
 *
 * Parsers are checked in registration order; the first non-null return wins.
 * This makes it straightforward to register new structured result types
 * (e.g. a new tool that signals a deploy event) without touching send-turn.ts.
 *
 * Default parsers (in priority order):
 *   1. HandoffToolResultParser — tool-originated handoff (com_handoff)
 *   2. TextHandoffParser       — text directive (HANDOFF: / FORWARD_TO:)
 */
export interface ITurnResultParser {
  parse(
    structuredResults: StructuredToolResult[],
    fullResponse: string,
    persistedContent: string,
    ctx: OrchestratorContext
  ): Partial<TurnResult> | null;
}

// ── 10. Slash Command ─────────────────────────────────────────────────────────

/**
 * A single in-chat slash command (e.g. /who, /history, /switch).
 * Registered into SlashCommandRegistry at startup via orchestrator plugins.
 * Adding a new command = implementing this interface + registering it.
 * The chat loop never changes.
 */
export interface ISlashCommand {
  /** Primary key, without the leading '/'. e.g. "who" → triggered by /who */
  readonly key: string;
  readonly aliases?: string[];
  readonly description: string;
  /** Brief usage example shown in /help, e.g. '/chat <name|role>'. Defaults to '/<key>'. */
  readonly usage?: string;
  /** When true, the LLM may invoke this command on behalf of the developer. */
  readonly llmCallable?: boolean;
  execute(rawArgs: string, ctx: OrchestratorContext): Promise<void>;
}

// ── 11. Hook Plugins (multi-hook extension points) ──────────────────────────

export interface TurnStartHookPayload {
  userMessage: string;
  options?: { skipPersist?: boolean };
  ctx: OrchestratorContext;
}

export interface MessagesPreparedHookPayload {
  messages: ChatCompletionMessageParam[];
  ctx: OrchestratorContext;
}

export interface SkillsResolvedHookPayload {
  skills: Skill[];
  missingSkillNames: string[];
  ctx: OrchestratorContext;
}

export interface ToolsResolvedHookPayload {
  tools: AgentTool[];
  toolDefs: LlmToolDefinition[];
  ctx: OrchestratorContext;
}

export interface BeforePersistAssistantMessageHookPayload {
  fullResponse: string;
  persistedContent: string;
  ctx: OrchestratorContext;
}

export interface AfterPersistAssistantMessageHookPayload {
  fullResponse: string;
  persistedContent: string;
  persistedMessage: ChatMessage;
  ctx: OrchestratorContext;
}

export interface TurnCompletedHookPayload {
  fullResponse: string;
  persistedContent: string;
  structuredResults: StructuredToolResult[];
  turnResult: TurnResult;
  ctx: OrchestratorContext;
}

/**
 * Hook plugin contract: one plugin can participate in multiple lifecycle hooks.
 * All methods are optional, so each plugin only implements what it needs.
 */
export interface IOrchestratorHookPlugin {
  readonly name: string;
  onTurnStart?(payload: TurnStartHookPayload): Promise<void> | void;
  onMessagesPrepared?(payload: MessagesPreparedHookPayload): Promise<void> | void;
  onSkillsResolved?(payload: SkillsResolvedHookPayload): Promise<void> | void;
  onToolsResolved?(payload: ToolsResolvedHookPayload): Promise<void> | void;
  onBeforePersistAssistantMessage?(
    payload: BeforePersistAssistantMessageHookPayload
  ): Promise<string | void> | string | void;
  onAfterPersistAssistantMessage?(
    payload: AfterPersistAssistantMessageHookPayload
  ): Promise<void> | void;
  onTurnCompleted?(payload: TurnCompletedHookPayload): Promise<void> | void;
}

// ── Plugin bundle ─────────────────────────────────────────────────────────────

/**
 * Full set of overridable pipeline stages passed to ChatOrchestrator.
 * All fields are optional — omitted stages use their default implementations.
 *
 * `enrichers` and `slashCommands` are additive arrays, merged with defaults.
 * All other fields replace their default completely when provided.
 */
export interface OrchestratorPlugins {
  compressor?: IContextCompressor;
  contextBuilder?: IContextBuilder;
  /** Additional enrichers merged with the built-in set. */
  enrichers?: IContextEnricher[];
  ragProvider?: IRagProvider;
  toolResolver?: IToolResolver;
  mcpGateway?: IMcpGateway;
  llmSelector?: ILlmSelector;
  outputHandler?: IOutputHandler;
  /** Additional slash commands merged with the built-in set. */
  slashCommands?: ISlashCommand[];
  /** Turn-result parsers replacing the built-in set when provided. */
  turnResultParsers?: ITurnResultParser[];
  /** Hook plugins merged with the built-in set. */
  hookPlugins?: IOrchestratorHookPlugin[];
}

/**
 * Fully resolved plugin bundle — all slots populated with concrete implementations.
 * Constructed by ChatOrchestrator from ServiceContainer defaults + any OrchestratorPlugins overrides.
 * send-turn.ts and other orchestrator modules receive this type (all required, no optionals).
 */
export interface ResolvedPlugins {
  compressor: IContextCompressor;
  contextBuilder: IContextBuilder;
  enrichers: IContextEnricher[];
  ragProvider: IRagProvider;
  toolResolver: IToolResolver;
  mcpGateway: IMcpGateway;
  llmSelector: ILlmSelector;
  outputHandler: IOutputHandler;
  slashCommands: ISlashCommand[];
  turnResultParsers: ITurnResultParser[];
  /** Optional for backward compatibility in tests; default resolves to []. */
  hookPlugins?: IOrchestratorHookPlugin[];
}

// ── Shared result types ────────────────────────────────────────────────────────

/** Result returned by send-turn.ts after a completed LLM turn. */
export interface TurnResult {
  /** Text response from the LLM (may be empty if the turn was all tool calls). */
  text: string;
  /** When true the loop should terminate (no handoff, no more input needed). */
  done?: boolean;
  /** True when handoff_to_agent was called. */
  handedOff?: boolean;
  /** ID of the target agent if handedOff. */
  handoffTargetId?: string;
  /** Pre-resolved target session ID (from the tool's ISessionGateway lookup). */
  handoffTargetSessionId?: string;
  /** Briefing note the handing-off agent provided. */
  handoffNote?: string;
}
