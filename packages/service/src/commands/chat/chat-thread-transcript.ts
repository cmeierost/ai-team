import type {
  Agent,
  ChatMessage,
  IAgentManager,
  ISessionManager,
  IThreadManager,
} from '@ai-team/core';

export type ChatThreadTranscriptEntry =
  | {
      kind: 'message';
      message: ChatMessage;
      agent?: Agent;
    }
  | {
      kind: 'handoff';
      message: ChatMessage;
      fromAgent?: Agent;
      toAgent?: Agent;
    };

interface OrderedEntry {
  entry: ChatThreadTranscriptEntry;
  timestampMs: number;
  order: number;
}

/**
 * Builds a presentation-only transcript for a complete session thread.
 *
 * This deliberately does not alter the active agent's runtime history. Each
 * personality continues to receive only the history loaded for its own session.
 */
export class ChatThreadTranscriptService {
  constructor(
    private readonly threadManager: IThreadManager,
    private readonly sessionManager: ISessionManager,
    private readonly agentManager: Pick<IAgentManager, 'getAgentAsync'>
  ) {}

  async load(sessionId: string): Promise<ChatThreadTranscriptEntry[]> {
    const sessions = await this.threadManager.getSessionChain(sessionId);
    const loaded = await Promise.all(
      sessions.map(async (session) => ({
        session,
        messages: await this.sessionManager.getSessionMessages(session.id),
      }))
    );

    const agentIds = new Set<string>();
    for (const { session, messages } of loaded) {
      for (const agentId of session.agentIds ?? []) agentIds.add(agentId);
      if (session.agentId) agentIds.add(session.agentId);
      for (const message of messages) {
        if (!message.isHuman && message.from) agentIds.add(message.from);
        if (message.to) agentIds.add(message.to);
        if (message.targetAgentId) agentIds.add(message.targetAgentId);
      }
    }

    const agents = new Map<string, Agent>();
    await Promise.all(
      Array.from(agentIds).map(async (agentId) => {
        const agent = await this.agentManager.getAgentAsync(agentId);
        if (agent) agents.set(agentId, agent);
      })
    );

    const seenHandoffs = new Set<string>();
    const entries: OrderedEntry[] = [];
    let order = 0;

    for (const { session, messages } of loaded) {
      const fallbackAgentId = session.agentIds?.[0] ?? session.agentId;
      for (const message of messages) {
        const timestampMs = Number.isFinite(Date.parse(message.timestamp))
          ? Date.parse(message.timestamp)
          : 0;

        if (message.handoffType === 'agent-briefing') {
          const handoffKey =
            message.handoffId ??
            `${message.handoffFromSessionId ?? ''}:${message.handoffToSessionId ?? ''}:${message.timestamp}:${message.content}`;
          if (seenHandoffs.has(handoffKey)) continue;
          seenHandoffs.add(handoffKey);
          entries.push({
            timestampMs,
            order: order++,
            entry: {
              kind: 'handoff',
              message,
              fromAgent: agents.get(message.from),
              toAgent: agents.get(message.to ?? message.targetAgentId ?? ''),
            },
          });
          continue;
        }

        if (message.handoffType) continue;

        entries.push({
          timestampMs,
          order: order++,
          entry: {
            kind: 'message',
            message,
            agent: message.isHuman
              ? undefined
              : agents.get(message.from) ?? agents.get(fallbackAgentId ?? ''),
          },
        });
      }
    }

    return entries
      .sort((left, right) => left.timestampMs - right.timestampMs || left.order - right.order)
      .map(({ entry }) => entry);
  }
}
