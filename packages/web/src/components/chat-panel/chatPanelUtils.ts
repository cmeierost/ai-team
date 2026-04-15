import type { CSSProperties } from 'react';
import type { Agent, ChatMessage, SessionActivatedTool } from '../../types';
import { getAgentColor } from '../../utils/color';
import type { ExtractedSessionMeta, NavigateAgentTarget } from './chatPanelTypes';

export const SESSION_ROUTE = '/chat/:agentId/session/:sessionId';
export const GRAPH_ROUTE = '/chat/:agentId/session/:sessionId/thread';
export const SESSION_META_PREFIX = '<!-- ai-team:session-meta ';
export const SESSION_META_SUFFIX = ' -->';

type PersistedToolCall = {
  tool?: string;
  params?: unknown;
  result?: unknown;
  resultLlm?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractErrorMessage(call: PersistedToolCall): string | undefined {
  if (
    isRecord(call.result) &&
    typeof call.result.message === 'string' &&
    call.result.message.trim()
  ) {
    return call.result.message;
  }
  if (typeof call.resultLlm === 'string' && call.resultLlm.trim()) {
    return call.resultLlm;
  }
  if (typeof call.result === 'string' && call.result.trim()) {
    return call.result;
  }
  return undefined;
}

function inferErrorLikeText(value: string): boolean {
  return /\b(fetch failed|failed|error|timeout|timed out|refused|unreachable)\b/i.test(value);
}

export function getPersistedToolStatus(call: PersistedToolCall): {
  phase: SessionActivatedTool['toolPhase'];
  outcome: NonNullable<SessionActivatedTool['toolResult']>['outcome'];
  message?: string;
  denial?: SessionActivatedTool['toolResult'] extends { denial?: infer D } ? D : never;
} {
  const result = call.result;

  const rawMessage = extractErrorMessage(call);
  const denial = isRecord(result) ? toPersistedDenial(result.denial, rawMessage) : undefined;
  const status =
    isRecord(result) && typeof result.status === 'string' ? result.status.toLowerCase() : undefined;

  if (denial?.kind === 'policy-denied' || denial?.kind === 'user-denied') {
    return {
      phase: 'denied',
      outcome: 'denied',
      message: rawMessage,
      denial,
    };
  }

  if (status === 'permission_denied' || status === 'access_denied' || status === 'denied') {
    return {
      phase: 'denied',
      outcome: 'denied',
      message: rawMessage,
      denial,
    };
  }

  if (status === 'error' || status === 'failed' || denial?.kind === 'execution-failed') {
    return {
      phase: 'error',
      outcome: 'error',
      message: rawMessage,
      denial,
    };
  }

  if (rawMessage && inferErrorLikeText(rawMessage)) {
    return {
      phase: 'error',
      outcome: 'error',
      message: rawMessage,
    };
  }

  return {
    phase: 'result',
    outcome: 'result',
  };
}

function toPersistedDenial(
  value: unknown,
  fallbackMessage?: string
): SessionActivatedTool['toolResult'] extends { denial?: infer D } ? D : never {
  if (!isRecord(value)) return undefined as never;

  const kind =
    value.kind === 'user-denied' ||
    value.kind === 'policy-denied' ||
    value.kind === 'execution-failed'
      ? value.kind
      : 'execution-failed';

  return {
    kind,
    reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode : 'tool_execution_failed',
    message:
      typeof value.message === 'string'
        ? value.message
        : (fallbackMessage ?? 'Tool execution failed'),
    blockedPaths: Array.isArray(value.blockedPaths)
      ? value.blockedPaths.filter((p): p is string => typeof p === 'string')
      : undefined,
    alternativeContexts: undefined,
    handoffRecommendation: undefined,
  } as never;
}

export function extractSessionActivatedTools(notes?: string): SessionActivatedTool[] {
  if (!notes?.includes(SESSION_META_PREFIX)) {
    return [];
  }
  const start = notes.lastIndexOf(SESSION_META_PREFIX);
  if (start < 0) {
    return [];
  }
  const jsonStart = start + SESSION_META_PREFIX.length;
  const end = notes.indexOf(SESSION_META_SUFFIX, jsonStart);
  if (end < 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(notes.slice(jsonStart, end)) as ExtractedSessionMeta;
    return Array.isArray(parsed.activatedTools) ? parsed.activatedTools : [];
  } catch {
    return [];
  }
}

/**
 * Backfill `toolResult.request` on activated tools that are missing it, using
 * the `tool_calls[].params` data that the backend attaches to each message row
 * (stored as `params_json` in `message_tool_calls`). This is needed after a
 * page reload because `activatedTools` is restored from session notes which
 * never includes the `request` field.
 */
export function backfillActivatedToolRequests(
  tools: SessionActivatedTool[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[]
): SessionActivatedTool[] {
  if (tools.length === 0) return tools;

  // Collect all (toolName → params) entries in message order so multiple
  // calls to the same tool are matched positionally.
  const allParams: Array<{ tool: string; params: unknown }> = [];
  for (const msg of messages) {
    if (Array.isArray(msg?.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.tool && tc.params !== undefined) {
          allParams.push({ tool: tc.tool, params: tc.params });
        }
      }
    }
  }
  if (allParams.length === 0) return tools;

  // Track how many times each tool name has been matched so successive calls
  // to the same tool get successive params entries.
  const matchCount = new Map<string, number>();

  return tools.map((tool) => {
    if (!tool.toolResult || tool.toolResult.request !== undefined) return tool;
    const toolName = tool.toolResult.toolName ?? tool.toolName;
    const used = matchCount.get(toolName) ?? 0;
    const candidates = allParams.filter((p) => p.tool === toolName);
    const match = candidates[used];
    if (match) {
      matchCount.set(toolName, used + 1);
      return { ...tool, toolResult: { ...tool.toolResult, request: match.params } };
    }
    return tool;
  });
}

/**
 * Reconstruct `activatedTools` from tool-result messages when no stored meta
 * is available (e.g. sessions created before activatedTools persistence was added).
 * Each message whose content starts with `[tool:name]` is treated as a completed call.
 */
export function reconstructActivatedToolsFromMessages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[]
): SessionActivatedTool[] {
  const results: SessionActivatedTool[] = [];
  for (const msg of messages) {
    if (msg?.isHuman || msg?.from === 'human') continue;
    const toolNameMatch = /^\[tool:([^\]]+)\]/.exec(msg?.content ?? '');
    if (!toolNameMatch) continue;
    const persistedCall = Array.isArray(msg.tool_calls)
      ? (msg.tool_calls[0] as PersistedToolCall)
      : undefined;
    const toolName = persistedCall?.tool ?? toolNameMatch[1];
    const status = persistedCall
      ? getPersistedToolStatus(persistedCall)
      : { phase: 'result' as const, outcome: 'result' as const };
    results.push({
      toolName,
      toolPhase: status.phase,
      message: status.message,
      timestamp: msg.timestamp ?? new Date().toISOString(),
      toolResult: {
        toolName,
        outcome: status.outcome,
        request: persistedCall?.params,
        result: persistedCall?.result,
        resultLlm: persistedCall?.resultLlm,
        denial: status.denial,
      },
    });
  }
  return results;
}

export function isHumanMessage(message: ChatMessage): boolean {
  return message.isHuman === true || message.from === 'human';
}

export function isHandoffMessage(message: ChatMessage): boolean {
  return Boolean(
    message.handoffType || message.to || /HANDOFF:\s*[a-z0-9-]+\s*\|/i.test(message.content)
  );
}

export function isAgentBriefing(message: ChatMessage): boolean {
  return message.handoffType === 'agent-briefing';
}

export function formatDeveloperName(developerId: string): string {
  if (developerId === 'human') {
    return 'You';
  }
  return developerId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function extractHandoffTarget(content: string): string | null {
  const handoffPattern = /HANDOFF:\s*([a-z0-9-]+)\s*\|/i;
  const match = handoffPattern.exec(content);
  return match ? match[1] : null;
}

export function resolveNavigateAgent(
  message: ChatMessage,
  agents: Agent[],
  currentAgentId?: string | null,
  routeAgentId?: string | null
): NavigateAgentTarget | null {
  const currentAgent = currentAgentId || routeAgentId || null;

  if (isHandoffMessage(message)) {
    const targetId = message.to || extractHandoffTarget(message.content);
    if (targetId && targetId !== currentAgent) {
      const agent = agents.find((entry) => entry.id === targetId);
      if (agent) {
        return { agent, sessionId: message.handoffToSessionId ?? null };
      }
    }
  }

  if (message.handoffType === 'agent-briefing' && message.from && message.from !== currentAgent) {
    const agent = agents.find((entry) => entry.id === message.from);
    if (agent) {
      return { agent, sessionId: message.handoffFromSessionId ?? null };
    }
  }

  return null;
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function toNameSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pickUniqueMatch(agents: Agent[], predicate: (agent: Agent) => boolean): Agent | null {
  const matches = agents.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve a route agent query (id/role/name/name-slug) to an exact agent.
 * Returns null when no unique match exists.
 */
export function resolveRouteAgent(agents: Agent[], query?: string | null): Agent | null {
  if (!query) {
    return null;
  }

  const normalized = normalizeIdentity(query);
  if (!normalized) {
    return null;
  }

  const byId = pickUniqueMatch(agents, (agent) => normalizeIdentity(agent.id) === normalized);
  if (byId) {
    return byId;
  }

  const byRole = pickUniqueMatch(agents, (agent) => normalizeIdentity(agent.role) === normalized);
  if (byRole) {
    return byRole;
  }

  const byName = pickUniqueMatch(agents, (agent) => normalizeIdentity(agent.name) === normalized);
  if (byName) {
    return byName;
  }

  return pickUniqueMatch(agents, (agent) => toNameSlug(agent.name) === normalized);
}

export function normalizeChatErrorMessage(rawMessage: string): string {
  return /question timeout|did not receive a response in time/i.test(rawMessage)
    ? 'The request could not be completed. Please try again.'
    : rawMessage;
}

export function buildSummaryMarkdown(messages: ChatMessage[], developerName?: string): string {
  return messages
    .map((message) => {
      const author = isHumanMessage(message)
        ? developerName || formatDeveloperName(message.from)
        : message.from;
      return `**${author}** (${new Date(message.timestamp).toLocaleString()}):\n${message.content}`;
    })
    .join('\n\n---\n\n');
}

function normalizeOptionalString(value: string | undefined): string {
  return value ?? '';
}

function normalizeOptionalBoolean(value: boolean | undefined): boolean {
  return value ?? false;
}

export function areMessagesEquivalent(left: ChatMessage, right: ChatMessage): boolean {
  return (
    left.from === right.from &&
    normalizeOptionalString(left.to) === normalizeOptionalString(right.to) &&
    normalizeOptionalBoolean(left.isHuman) === normalizeOptionalBoolean(right.isHuman) &&
    left.content === right.content &&
    normalizeOptionalBoolean(left.archived) === normalizeOptionalBoolean(right.archived) &&
    normalizeOptionalString(left.handoffType) === normalizeOptionalString(right.handoffType) &&
    normalizeOptionalString(left.targetAgentId) === normalizeOptionalString(right.targetAgentId) &&
    normalizeOptionalString(left.handoffId) === normalizeOptionalString(right.handoffId) &&
    normalizeOptionalString(left.handoffFromSessionId) ===
      normalizeOptionalString(right.handoffFromSessionId) &&
    normalizeOptionalString(left.handoffToSessionId) ===
      normalizeOptionalString(right.handoffToSessionId)
  );
}

export function findMatchingMessageIndex(
  messages: ChatMessage[],
  target: ChatMessage,
  preferredIndex: number
): number {
  const exactTimestampIndex = messages.findIndex(
    (message, index) => index === preferredIndex && message.timestamp === target.timestamp
  );
  if (exactTimestampIndex >= 0) {
    return exactTimestampIndex;
  }

  const candidateIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => areMessagesEquivalent(message, target))
    .map(({ index }) => index);

  if (candidateIndexes.length === 0) {
    return -1;
  }

  return candidateIndexes.slice(1).reduce((bestIndex, candidateIndex) => {
    const bestDistance = Math.abs(bestIndex - preferredIndex);
    const candidateDistance = Math.abs(candidateIndex - preferredIndex);
    return candidateDistance < bestDistance ? candidateIndex : bestIndex;
  }, candidateIndexes[0]);
}

export function findMatchingMessage(
  messages: ChatMessage[],
  target: ChatMessage,
  preferredIndex: number
): ChatMessage | null {
  const matchedIndex = findMatchingMessageIndex(messages, target, preferredIndex);
  return matchedIndex >= 0 ? (messages[matchedIndex] ?? null) : null;
}

export function getMessageStyle(
  message: ChatMessage,
  agents: Agent[],
  fallbackAgent?: Agent
): CSSProperties | undefined {
  if (isHumanMessage(message)) {
    return undefined;
  }
  const senderAgent = agents.find((agent) => agent.id === message.from) ?? fallbackAgent;
  if (!senderAgent) {
    return undefined;
  }
  return { '--agent-color': getAgentColor(senderAgent) } as CSSProperties;
}

export function getMessageDisplayName(
  message: ChatMessage,
  agents: Agent[],
  fallbackAgent: Agent | undefined,
  developerName?: string
): string {
  if (isHumanMessage(message)) {
    return developerName || formatDeveloperName(message.from);
  }

  if (isAgentBriefing(message) && message.to) {
    const fromAgent = agents.find((agent) => agent.id === message.from) ?? fallbackAgent;
    const toAgent = agents.find((agent) => agent.id === message.to);
    return `${fromAgent?.name ?? message.from} → ${toAgent?.name ?? message.to}`;
  }

  return (agents.find((agent) => agent.id === message.from) ?? fallbackAgent)?.name ?? message.from;
}
