/**
 * OrchestratorContext — the single object threaded through every pipeline stage.
 *
 * Every pipeline interface (IContextCompressor, IContextBuilder, IRagProvider, …)
 * receives this as its sole "environment" argument. Stages read and optionally
 * mutate their own slice; they never depend on each other directly.
 *
 * Constructed once per session and updated on handoff (new agent, same managers).
 */

import type {
  Agent,
  AgentManager,
  ChatMessage,
  ContextManager,
  InstructionFile,
  LlmService,
  ToolManager,
  SkillManager,
} from '@ai-team/core';
import type { SessionManager } from '../session-manager.js';
import type { ChatRuntimeHooks } from '../contracts.js';

export interface NavStackEntry {
  agentId: string;
  sessionId: string;
  agentName: string;
}

export interface OrchestratorContext {
  /** The agent currently handling the user's message. Updated on handoff. */
  agent: Agent;

  /** Absolute path to the workspace root — used for file permission checks. */
  workspaceRoot: string;

  /** Active session ID (in SessionManager / SQLite). */
  sessionId: string;

  /** Surface-provided hooks: abort signal, event emitter, question bridges, workflow state. */
  hooks: ChatRuntimeHooks;

  /** Navigation stack for /back — tracks agents we came from. */
  navStack?: NavStackEntry[];

  // ── Managers (injected at construction, shared across the whole session) ──
  toolManager: ToolManager;
  sessionManager: SessionManager;
  agentManager: AgentManager;
  skillManager: SkillManager;
  llmService: LlmService;
  contextManager: ContextManager;

  /** Message history for the current agent session. */
  history: ChatMessage[];

  /** Workspace instruction files loaded from `.ai-team/instructions/`. */
  instructions?: InstructionFile[];
}
