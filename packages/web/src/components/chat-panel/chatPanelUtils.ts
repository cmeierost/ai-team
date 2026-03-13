import type { CSSProperties } from 'react';
import type { Agent, ChatMessage, SessionActivatedTool } from '../../types';
import { getAgentColor } from '../../utils/color';
import type { ExtractedSessionMeta, NavigateAgentTarget } from './chatPanelTypes';

export const SESSION_ROUTE = '/chat/:agentId/session/:sessionId';
export const GRAPH_ROUTE = '/chat/:agentId/session/:sessionId/thread';
export const SESSION_META_PREFIX = '<!-- ai-team:session-meta ';
export const SESSION_META_SUFFIX = ' -->';

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

export function isHumanMessage(message: ChatMessage): boolean {
  return message.isHuman === true || message.from === 'human';
}

export function isHandoffMessage(message: ChatMessage): boolean {
  return Boolean(
    message.handoffType ||
      message.to ||
      /HANDOFF:\s*[a-z0-9-]+\s*\|/i.test(message.content),
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

export function resolveNavigateAgent(message: ChatMessage, agents: Agent[], currentAgentId?: string | null, routeAgentId?: string | null): NavigateAgentTarget | null {
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
  return left.from === right.from
    && normalizeOptionalString(left.to) === normalizeOptionalString(right.to)
    && normalizeOptionalBoolean(left.isHuman) === normalizeOptionalBoolean(right.isHuman)
    && left.content === right.content
    && normalizeOptionalBoolean(left.archived) === normalizeOptionalBoolean(right.archived)
    && normalizeOptionalString(left.handoffType) === normalizeOptionalString(right.handoffType)
    && normalizeOptionalString(left.targetAgentId) === normalizeOptionalString(right.targetAgentId)
    && normalizeOptionalString(left.handoffId) === normalizeOptionalString(right.handoffId)
    && normalizeOptionalString(left.handoffFromSessionId) === normalizeOptionalString(right.handoffFromSessionId)
    && normalizeOptionalString(left.handoffToSessionId) === normalizeOptionalString(right.handoffToSessionId);
}

export function findMatchingMessageIndex(messages: ChatMessage[], target: ChatMessage, preferredIndex: number): number {
  const exactTimestampIndex = messages.findIndex((message, index) => index === preferredIndex && message.timestamp === target.timestamp);
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

export function findMatchingMessage(messages: ChatMessage[], target: ChatMessage, preferredIndex: number): ChatMessage | null {
  const matchedIndex = findMatchingMessageIndex(messages, target, preferredIndex);
  return matchedIndex >= 0 ? messages[matchedIndex] ?? null : null;
}

export function getMessageStyle(message: ChatMessage, agents: Agent[], fallbackAgent?: Agent): CSSProperties | undefined {
  if (isHumanMessage(message)) {
    return undefined;
  }
  const senderAgent = agents.find((agent) => agent.id === message.from) ?? fallbackAgent;
  if (!senderAgent) {
    return undefined;
  }
  return { '--agent-color': getAgentColor(senderAgent) } as CSSProperties;
}

export function getMessageDisplayName(message: ChatMessage, agents: Agent[], fallbackAgent: Agent | undefined, developerName?: string): string {
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
