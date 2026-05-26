import type { ChatMessage, SessionActivatedTool } from '../types';

function getToolIdentity(event: SessionActivatedTool): string {
  return event.toolResult?.toolName ?? event.toolName ?? 'unknown-tool';
}

function isFinalPhase(phase?: SessionActivatedTool['toolPhase']): boolean {
  return phase === 'result' || phase === 'error' || phase === 'denied';
}

function normalizeForKey(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForKey(entry));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const out: Record<string, unknown> = {};
    for (const [key, entry] of entries) {
      out[key] = normalizeForKey(entry);
    }
    return out;
  }
  return value;
}

function requestSignature(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(normalizeForKey(value));
  } catch {
    return '[unserializable-request]';
  }
}

function mergeToolEventTransitions(events: SessionActivatedTool[]): SessionActivatedTool[] {
  type Invocation = {
    toolName: string;
    toolCallId?: string;
    requestSig: string;
    event: SessionActivatedTool;
    finalized: boolean;
  };

  const invocations: Invocation[] = [];

  const matchesInvocation = (
    candidate: Invocation,
    toolName: string,
    toolCallId: string | undefined,
    reqSig: string
  ): boolean => {
    if (candidate.finalized) return false;
    if (toolCallId && candidate.toolCallId && candidate.toolCallId !== toolCallId) return false;
    if (candidate.toolName !== toolName) return false;
    if (reqSig && candidate.requestSig && reqSig !== candidate.requestSig) return false;
    return true;
  };

  for (const event of events) {
    const toolName = getToolIdentity(event);
    const toolCallId = event.toolCallId;
    const reqSig = requestSignature(event.toolResult?.request);
    const phase = event.toolPhase;

    if (phase === 'request' || phase === 'start') {
      let matchIndex = -1;
      for (let i = invocations.length - 1; i >= 0; i -= 1) {
        if (matchesInvocation(invocations[i], toolName, toolCallId, reqSig)) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex >= 0) {
        const previous = invocations[matchIndex].event;
        const mergedRequest = event.toolResult?.request ?? previous.toolResult?.request;
        const mergedToolResult = (() => {
          const source = event.toolResult ?? previous.toolResult;
          if (!source) {
            return undefined;
          }

          return {
            ...source,
            toolName: source.toolName ?? toolName,
            outcome: source.outcome ?? phase,
            request: mergedRequest,
          };
        })();

        invocations[matchIndex] = {
          toolName,
          toolCallId: invocations[matchIndex].toolCallId ?? toolCallId,
          requestSig: invocations[matchIndex].requestSig || reqSig,
          finalized: false,
          event: {
            ...previous,
            ...event,
            // keep original timestamp for stable key/position while phase advances
            timestamp: previous.timestamp,
            toolResult: mergedToolResult,
          },
        };
      } else {
        invocations.push({ toolName, toolCallId, requestSig: reqSig, event, finalized: false });
      }
      continue;
    }

    if (isFinalPhase(phase)) {
      let matchIndex = -1;
      for (let i = invocations.length - 1; i >= 0; i -= 1) {
        if (matchesInvocation(invocations[i], toolName, toolCallId, reqSig)) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex >= 0) {
        const previous = invocations[matchIndex].event;
        const mergedRequest = event.toolResult?.request ?? previous.toolResult?.request;
        const mergedToolResult = (() => {
          if (!event.toolResult && !previous.toolResult) {
            return undefined;
          }

          const mergedToolName =
            event.toolResult?.toolName ?? previous.toolResult?.toolName ?? toolName;
          const mergedOutcome =
            event.toolResult?.outcome ??
            previous.toolResult?.outcome ??
            (phase === 'error' ? 'error' : phase === 'denied' ? 'denied' : 'result');

          return {
            toolName: mergedToolName,
            outcome: mergedOutcome,
            request: mergedRequest,
            commandResponse:
              event.toolResult?.commandResponse ?? previous.toolResult?.commandResponse,
            resultLlm: event.toolResult?.resultLlm ?? previous.toolResult?.resultLlm,
            denial: event.toolResult?.denial ?? previous.toolResult?.denial,
          };
        })();

        invocations[matchIndex] = {
          toolName,
          toolCallId: invocations[matchIndex].toolCallId ?? toolCallId,
          requestSig: invocations[matchIndex].requestSig,
          finalized: true,
          event: {
            ...previous,
            ...event,
            timestamp: previous.timestamp,
            toolResult: mergedToolResult,
          },
        };
      } else {
        invocations.push({ toolName, toolCallId, requestSig: reqSig, event, finalized: true });
      }
      continue;
    }

    invocations.push({ toolName, toolCallId, requestSig: reqSig, event, finalized: true });
  }

  return invocations.map((invocation) => invocation.event);
}

function compareToolEvents(a: SessionActivatedTool, b: SessionActivatedTool): number {
  const aSeq = a.toolEventSeq;
  const bSeq = b.toolEventSeq;
  const aHasSeq = typeof aSeq === 'number' && Number.isFinite(aSeq);
  const bHasSeq = typeof bSeq === 'number' && Number.isFinite(bSeq);

  if (aHasSeq && bHasSeq && aSeq !== bSeq) {
    return aSeq - bSeq;
  }
  if (aHasSeq && !bHasSeq) {
    return -1;
  }
  if (!aHasSeq && bHasSeq) {
    return 1;
  }

  return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
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
  if (messages.length === 0 || activatedTools.length === 0) {
    return result;
  }

  // Pre-parse timestamps once.
  const msgTimestamps = messages.map((m) => new Date(m.timestamp).getTime());
  const toolTimestamps = activatedTools.map((e) => new Date(e.timestamp).getTime());
  const assistantIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => !(message.isHuman === true || message.from === 'human'))
    .map(({ index }) => index);

  if (assistantIndexes.length === 0) {
    return result;
  }

  const groupedByMessage = new Map<number, SessionActivatedTool[]>();

  for (let j = 0; j < activatedTools.length; j += 1) {
    const event = activatedTools[j];
    const ts = toolTimestamps[j];
    const normalizedTs = Number.isFinite(ts) ? ts : Date.now();
    let targetIndex = -1;

    // Prefer the latest assistant message that already exists by event time.
    for (const assistantIndex of assistantIndexes) {
      if (msgTimestamps[assistantIndex] <= normalizedTs + 2000) {
        targetIndex = assistantIndex;
      } else {
        break;
      }
    }

    if (targetIndex < 0) {
      // Clock skew fallback: pick first nearby assistant message.
      for (const assistantIndex of assistantIndexes) {
        if (msgTimestamps[assistantIndex] >= normalizedTs - 2000) {
          targetIndex = assistantIndex;
          break;
        }
      }
    }

    if (targetIndex < 0) {
      targetIndex = assistantIndexes[assistantIndexes.length - 1];
    }

    const bucket = groupedByMessage.get(targetIndex) ?? [];
    bucket.push(event);
    groupedByMessage.set(targetIndex, bucket);
  }

  for (const [messageIndex, group] of groupedByMessage.entries()) {
    const sorted = [...group].sort(compareToolEvents);
    result.set(messageIndex, mergeToolEventTransitions(sorted));
  }

  return result;
}
