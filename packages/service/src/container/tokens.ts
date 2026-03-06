/**
 * TOKENS — canonical service tokens for the ServiceContainer.
 *
 * Import this object wherever you need to register or resolve a service.
 * Adding a new service: add a new entry here, register it in bootstrap.ts.
 * No other file needs to change — Open/Closed.
 *
 * Naming convention: token id matches the interface/class name for clarity
 * in error messages and debug output.
 */

import type {
  AgentManager,
  ContextManager,
  LlmService,
  SkillManager,
  ToolManager,
} from '@ai-team/core';
import type { IMessageStorage } from '../storage/contracts.js';
import type { SessionManager } from '../session-manager.js';
import type {
  IContextBuilder,
  IContextCompressor,
  IContextEnricher,
  ILlmSelector,
  IMcpGateway,
  IOutputHandler,
  IRagProvider,
  ISlashCommand,
  IToolResolver,
} from '../orchestrator/pipeline.js';
import { Token } from './token.js';

export const TOKENS = {
  // ── Core infrastructure ─────────────────────────────────────────────────
  WorkspaceRoot:    new Token<string>('WorkspaceRoot'),
  MessageStorage:   new Token<IMessageStorage>('IMessageStorage'),
  LlmService:       new Token<LlmService>('LlmService'),
  AgentManager:     new Token<AgentManager>('AgentManager'),
  SkillManager:     new Token<SkillManager>('SkillManager'),
  SessionManager:   new Token<SessionManager>('SessionManager'),
  ContextManager:   new Token<ContextManager>('ContextManager'),
  ToolManager:      new Token<ToolManager>('ToolManager'),

  // ── Pipeline plugins — all override-able before first resolve ───────────
  ContextCompressor: new Token<IContextCompressor>('IContextCompressor'),
  ContextBuilder:    new Token<IContextBuilder>('IContextBuilder'),
  /** Array of enrichers; resolved as a single Token to keep ordering explicit. */
  ContextEnrichers:  new Token<IContextEnricher[]>('IContextEnricher[]'),
  RagProvider:       new Token<IRagProvider>('IRagProvider'),
  ToolResolver:      new Token<IToolResolver>('IToolResolver'),
  McpGateway:        new Token<IMcpGateway>('IMcpGateway'),
  LlmSelector:       new Token<ILlmSelector>('ILlmSelector'),
  OutputHandler:     new Token<IOutputHandler>('IOutputHandler'),
  /** Array of slash commands; each command registers itself. */
  SlashCommands:     new Token<ISlashCommand[]>('ISlashCommand[]'),
} as const;
