import type { ChatMessage, SessionActivatedTool } from '../types';

const PHASE_RANK: Record<string, number> = {
  result: 5,
  error: 4,
  denied: 3,
  start: 2,
  request: 1,
};

function phaseRank(phase?: string): number {
  return phase ? (PHASE_RANK[phase] ?? 0) : 0;
}

/**
 * Group activated tool events by assistant message index.
 *
 * For each assistant message at index i, we collect tool events whose
 * timestamps fall between messages[i-1].timestamp (exclusive) and
 * messages[i].timestamp + 2s tolerance (inclusive).
 *
 * Within each group, events for the same tool name are deduplicated by
 * "highest phase wins" (result > error > denied > start > request),
 * breaking ties by most recent timestamp.
 *
 * Returns a Map from message index → deduplicated tool events.
 */
export function groupToolEventsForMessage(
  messages: ChatMessage[],
  activatedTools: SessionActivatedTool[],
): Map<number, SessionActivatedTool[]> {
  const result = new Map<number, SessionActivatedTool[]>();

  // Pre-parse all timestamps once to avoid repeated Date construction in the inner loop.
  const msgTimestamps = messages.map((m) => new Date(m.timestamp).getTime());
  const toolTimestamps = activatedTools.map((e) => new Date(e.timestamp).getTime());
  // WeakMap-style O(1) lookup so the dedup loop doesn't call indexOf.
  const toolTsMap = new Map<SessionActivatedTool, number>(activatedTools.map((e, j) => [e, toolTimestamps[j]]));

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.isHuman === true || msg.from === 'human') continue;

    const msgTs = msgTimestamps[i];
    const prevTs = i > 0 ? msgTimestamps[i - 1] : 0;

    const group = activatedTools.filter((_event, j) => {
      const ts = toolTimestamps[j];
      return ts > prevTs && ts <= msgTs + 2000;
    });

    if (group.length === 0) continue;

    // Deduplicate: keep highest-phase event per tool invocation identity.
    // Use a parallel map for pre-parsed timestamps to avoid repeated Date construction.
    const byName = new Map<string, { event: SessionActivatedTool; ts: number }>();
    for (const event of group) {
      const id = event.toolResult?.toolName ?? event.toolName;
      const eventTs = toolTsMap.get(event) ?? 0;
      const existing = byName.get(id);
      if (!existing) {
        byName.set(id, { event, ts: eventTs });
      } else {
        const existingRank = phaseRank(existing.event.toolPhase);
        const eventRank = phaseRank(event.toolPhase);
        if (eventRank > existingRank || (eventRank === existingRank && eventTs >= existing.ts)) {
          byName.set(id, { event, ts: eventTs });
        }
      }
    }

    result.set(i, Array.from(byName.values(), ({ event }) => event));
  }

  return result;
}
