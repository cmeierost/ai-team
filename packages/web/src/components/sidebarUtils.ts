import type { Agent, ChatSession } from '../types';

function resolvePrimaryAgentId(session: ChatSession): string | null {
  return session.agentIds?.[0] ?? session.agentId ?? null;
}

export function resolveSidebarChatPath(recentSessions: ChatSession[], agents: Agent[]): string | null {
  const knownAgentIds = new Set(agents.map((agent) => agent.id));
  const sortedSessions = [...recentSessions].sort((left, right) => {
    const rightTime = new Date(right.lastActivityAt).getTime();
    const leftTime = new Date(left.lastActivityAt).getTime();

    return rightTime - leftTime;
  });

  for (const session of sortedSessions) {
    const agentId = resolvePrimaryAgentId(session);
    if (!agentId) {
      continue;
    }

    if (knownAgentIds.size > 0 && !knownAgentIds.has(agentId)) {
      continue;
    }

    return `/chat/${agentId}/session/${session.id}`;
  }

  const fallbackAgentId = agents[0]?.id;
  return fallbackAgentId ? `/chat/${fallbackAgentId}` : null;
}