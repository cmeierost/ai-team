/**
 * Workflow runtime pipeline interfaces — the complete extension surface for chat workflows.
 *
 * OPEN/CLOSED PRINCIPLE: Every extension seam is defined here as an interface.
 * The chat runtime controller composes and calls these interfaces. New capabilities are added by:
 *   1. Implementing the interface
 *   2. Passing it to the runtime controller plugin bundle
 * No runtime controller changes required.
 *
 * Default implementations are composed from runtime plugin services
 * in `workflow/chat/runtime-plugin-services.ts` plus concrete adapter
 * implementations in `workflow/chat/runtime-defaults.ts`.
 */

import type {
  ICommand,
  ChatMessage,
  ILlmChatMessageParam,
  StructuredToolResult,
  ExecutionContext,
} from '@ai-team/core';
import type { ICommandDispatcher } from '@ai-team/api-contracts';
import type { PreLlmIntentProvider } from '../../interaction/intents/pre-llm-intents.js';

// ── 1. Context Compression ────────────────────────────────────────────────────

export interface IContextCompressor {
  compress(history: ChatMessage[], ctx: ExecutionContext): Promise<ChatMessage[]>;
}

// ── 2. Context Builder ────────────────────────────────────────────────────────

export interface IContextBuilder {
  build(history: ChatMessage[], ctx: ExecutionContext): Promise<ILlmChatMessageParam[]>;
}

// ── 3. Context Enricher ───────────────────────────────────────────────────────

export interface IContextEnricher {
  readonly name: string;
  enrich(ctx: ExecutionContext): Promise<string | null>;
}

// ── 4. RAG Provider ───────────────────────────────────────────────────────────

export interface IRagProvider {
  retrieve(query: string, ctx: ExecutionContext): Promise<string | null>;
}

// ── 5. Tool Resolver ──────────────────────────────────────────────────────────

export interface IToolResolver {
  resolve(ctx: ExecutionContext): Promise<ICommand[]>;
}

// ── 6. MCP Gateway ────────────────────────────────────────────────────────────

export interface IMcpGateway {
  discover(): Promise<ICommand[]>;
}

// ── 7. LLM Selector ───────────────────────────────────────────────────────────

export interface ILlmSelector {
  select(ctx: ExecutionContext): Promise<void>;
}

// ── 8. Output Handler ─────────────────────────────────────────────────────────

export interface IOutputHandler {
  handle(result: TurnResult, ctx: ExecutionContext): Promise<void>;
}

// ── 9. Turn Result Parser ─────────────────────────────────────────────────────

export interface ITurnResultParser {
  parse(
    structuredResults: StructuredToolResult[],
    fullResponse: string,
    persistedContent: string,
    ctx: ExecutionContext
  ): Partial<TurnResult> | null;
}

// ── Plugin bundle ─────────────────────────────────────────────────────────────

export interface OrchestratorPlugins {
  compressor?: IContextCompressor;
  contextBuilder?: IContextBuilder;
  enrichers?: IContextEnricher[];
  ragProvider?: IRagProvider;
  toolResolver?: IToolResolver;
  mcpGateway?: IMcpGateway;
  llmSelector?: ILlmSelector;
  outputHandler?: IOutputHandler;
  commandDispatcher?: ICommandDispatcher;
  turnResultParsers?: ITurnResultParser[];
  preLlmIntentProviders?: PreLlmIntentProvider[];
}

export interface ResolvedPlugins {
  compressor: IContextCompressor;
  contextBuilder: IContextBuilder;
  enrichers: IContextEnricher[];
  ragProvider: IRagProvider;
  toolResolver: IToolResolver;
  mcpGateway: IMcpGateway;
  llmSelector: ILlmSelector;
  outputHandler: IOutputHandler;
  commandDispatcher: ICommandDispatcher;
  turnResultParsers: ITurnResultParser[];
  preLlmIntentProviders?: PreLlmIntentProvider[];
}

// ── Shared result types ───────────────────────────────────────────────────────

export interface TurnResult {
  text: string;
  done?: boolean;
  handedOff?: boolean;
  handoffTargetId?: string;
  handoffTargetSessionId?: string;
  handoffNote?: string;
  handoffTargetWorkflowId?: string;
  handoffWorkflowToolPolicy?: {
    allow?: string[];
    deny?: string[];
    add?: string[];
    remove?: string[];
  };
}
