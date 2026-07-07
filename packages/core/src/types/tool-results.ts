/**
 * Typed result shapes for structured tool returns.
 *
 * These are pure data types — no orchestrator dependency.
 * The service layer's tool-dispatch.ts detects these by `result.type`
 * to trigger orchestration side-effects (session switch, agent creation, etc.).
 *
 * Result types produced by factory-injected orchestration tools:
 *   HandoffRequest           — com_handoff   (orchestrator switches active agent)
 *   HireResult               — hr_hire       (agent was created; orchestrator notifies surface)
 *   FindCapableAgentResult   — fs_who_should (actual matches, not a deferred request)
 *   ToolCatalogResult        — tool_list     (actual catalog snapshot, not a deferred request)
 *   TeamListResult           — team_list     (actual team roster snapshot)
 */

// ── Shared introspection types ──────────────────────────────────────────────

/** A single entry in the tool catalog returned by ToolManager.catalog(). */
export interface ToolCatalogEntry {
  name: string;
  description: string;
  /** Logical group this tool belongs to (e.g. 'fs', 'search', 'hr', 'com'). */
  group?: string;
  schema: Record<string, unknown>;
  tags?: string[];
  examples?: string[];
}

// ── Handoff ───────────────────────────────────────────────────────────────────

export interface HandoffRequest {
  type: 'handoff';
  targetAgentId: string;
  /** Final dominant instruction for the target agent. May include prepended prior-context summary. */
  briefingNote: string;
  /** Optional summary of the prior conversation, prepended into briefingNote as context. */
  summary?: string;
  /** Pre-resolved by com_handoff via ISessionGateway — skips a redundant lookup in tool-dispatch. */
  targetSessionId?: string;
  timestamp: string;
}

// ── Hire ──────────────────────────────────────────────────────────────────────

export interface HireResult {
  type: 'hire';
  /** ID of the agent that was actually created. */
  agentId: string;
  name: string;
  role: string;
  specializations: string[];
  reportsTo?: string;
  timestamp: string;
}

// ── Find capable agent (resolved) ─────────────────────────────────────────────

export interface AgentMatch {
  agentId: string;
  agentName: string;
  agentRole: string;
}

export interface FindCapableAgentResult {
  type: 'fs_who_should_result';
  task: string;
  matches: AgentMatch[];
  timestamp: string;
}

// ── Tool catalog snapshot ─────────────────────────────────────────────────────

export interface ToolCatalogResult {
  type: 'tool_list_result';
  entries: ToolCatalogEntry[];
  timestamp: string;
}

// ── Team roster snapshot ─────────────────────────────────────────────────────

export interface TeamListMember {
  agentId: string;
  agentName: string;
  agentRole: string;
}

export interface TeamListResult {
  type: 'team_list_result';
  members: TeamListMember[];
  timestamp: string;
}

// ── Union + type guards ───────────────────────────────────────────────────────

/** Union of all structured tool result types the orchestrator handles specially. */
export type StructuredToolResult =
  | HandoffRequest
  | HireResult
  | FindCapableAgentResult
  | ToolCatalogResult
  | TeamListResult;

export function isHandoffRequest(value: unknown): value is HandoffRequest {
  return typeof value === 'object' && value !== null && (value as any).type === 'handoff';
}

export function isHireResult(value: unknown): value is HireResult {
  return typeof value === 'object' && value !== null && (value as any).type === 'hire';
}

export function isFindCapableAgentResult(value: unknown): value is FindCapableAgentResult {
  return (
    typeof value === 'object' && value !== null && (value as any).type === 'fs_who_should_result'
  );
}

export function isToolCatalogResult(value: unknown): value is ToolCatalogResult {
  return typeof value === 'object' && value !== null && (value as any).type === 'tool_list_result';
}

export function isTeamListResult(value: unknown): value is TeamListResult {
  return typeof value === 'object' && value !== null && (value as any).type === 'team_list_result';
}

export function isStructuredToolResult(value: unknown): value is StructuredToolResult {
  return (
    isHandoffRequest(value) ||
    isHireResult(value) ||
    isFindCapableAgentResult(value) ||
    isToolCatalogResult(value) ||
    isTeamListResult(value)
  );
}
