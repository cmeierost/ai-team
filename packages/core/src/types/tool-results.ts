/**
 * Typed result shapes for structured tool returns.
 *
 * These are pure data types — no orchestrator dependency.
 * The service layer's tool-dispatch.ts detects these by `result.type`
 * to trigger orchestration side-effects (session switch, agent creation, etc.).
 *
 * Result types produced by factory-injected orchestration tools:
 *   HandoffRequest           — handoff_to_agent (orchestrator switches active agent)
 *   HireResult               — hire_agent        (agent was created; orchestrator notifies surface)
 *   FindCapableAgentResult   — find_capable_agent (actual matches, not a deferred request)
 *   ToolCatalogResult        — list_tools         (actual catalog snapshot, not a deferred request)
 */

// ── Shared introspection types ──────────────────────────────────────────────

/** A single entry in the tool catalog returned by ToolManager.catalog(). */
export interface ToolCatalogEntry {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  tags?: string[];
  examples?: string[];
}

// ── Handoff ───────────────────────────────────────────────────────────────────

export interface HandoffRequest {
  type: 'handoff';
  targetAgentId: string;
  briefingNote: string;
  /** Pre-resolved by handoff_to_agent via ISessionGateway — skips a redundant lookup in tool-dispatch. */
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
  type: 'find_capable_agent_result';
  task: string;
  matches: AgentMatch[];
  timestamp: string;
}

// ── Tool catalog snapshot ─────────────────────────────────────────────────────

export interface ToolCatalogResult {
  type: 'list_tools_result';
  entries: ToolCatalogEntry[];
  timestamp: string;
}

// ── Union + type guards ───────────────────────────────────────────────────────

/** Union of all structured tool result types the orchestrator handles specially. */
export type StructuredToolResult =
  | HandoffRequest
  | HireResult
  | FindCapableAgentResult
  | ToolCatalogResult;

export function isHandoffRequest(value: unknown): value is HandoffRequest {
  return typeof value === 'object' && value !== null && (value as any).type === 'handoff';
}

export function isHireResult(value: unknown): value is HireResult {
  return typeof value === 'object' && value !== null && (value as any).type === 'hire';
}

export function isFindCapableAgentResult(value: unknown): value is FindCapableAgentResult {
  return typeof value === 'object' && value !== null && (value as any).type === 'find_capable_agent_result';
}

export function isToolCatalogResult(value: unknown): value is ToolCatalogResult {
  return typeof value === 'object' && value !== null && (value as any).type === 'list_tools_result';
}

export function isStructuredToolResult(value: unknown): value is StructuredToolResult {
  return (
    isHandoffRequest(value) ||
    isHireResult(value) ||
    isFindCapableAgentResult(value) ||
    isToolCatalogResult(value)
  );
}
