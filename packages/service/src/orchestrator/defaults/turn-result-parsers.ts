/**
 * Default ITurnResultParser implementations.
 *
 * Each parser inspects the raw outputs of a completed LLM turn and returns a
 * Partial<TurnResult> override when it recognises its signal, or null to pass
 * control to the next parser.
 *
 * Registration order = priority:
 *   1. HandoffToolResultParser — tool-originated handoff wins over text
 *   2. TextHandoffParser       — text directive (HANDOFF:/FORWARD_TO:)
 *
 * Add new parsers by implementing ITurnResultParser and inserting them at the
 * appropriate position in buildDefaultTurnResultParsers().
 */

import { isHandoffRequest, type Agent, type StructuredToolResult } from '@ai-team/infrastructure';
import type { ITurnResultParser, TurnResult } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';
import { parseHandoffDirective } from '../../commands/chat/index.js';

// ── Shared agent resolution helper ────────────────────────────────────────────

/**
 * Resolves a target agent ID to an Agent that is not the current agent.
 * Tries exact lookup first, then fuzzy resolution via resolveAgent.
 * Returns undefined when no valid non-self target can be found.
 */
function resolveNonSelfAgent(
  targetId: string,
  ctx: OrchestratorContext,
): Agent | undefined {
  const getAgent = (ctx.agentManager as { getAgent?: (query: string) => Agent | undefined }).getAgent;
  const resolveAgent = (ctx.agentManager as { resolveAgent?: (query: string) => Agent[] }).resolveAgent;

  const exact = typeof getAgent === 'function'
    ? getAgent.call(ctx.agentManager, targetId)
    : undefined;

  if (exact && exact.id !== ctx.agent.id) return exact;

  return typeof resolveAgent === 'function'
    ? resolveAgent.call(ctx.agentManager, targetId).find((a) => a.id !== ctx.agent.id)
    : undefined;
}

// ── 1. Handoff from tool call ─────────────────────────────────────────────────

export class HandoffToolResultParser implements ITurnResultParser {
  parse(
    structuredResults: StructuredToolResult[],
    _fullResponse: string,
    persistedContent: string,
    ctx: OrchestratorContext,
  ): Partial<TurnResult> | null {
    const handoffReq = structuredResults.find(isHandoffRequest);
    if (!handoffReq || !isHandoffRequest(handoffReq)) return null;

    const target = resolveNonSelfAgent(handoffReq.targetAgentId, ctx);

    if (!target) {
      return { text: persistedContent, done: false };
    }

    return {
      text: persistedContent,
      done: false,
      handedOff: true,
      handoffTargetId: target.id,
      handoffTargetSessionId: handoffReq.targetSessionId,
      handoffNote: handoffReq.briefingNote,
    };
  }
}

// ── 2. Handoff from text directive ────────────────────────────────────────────

export class TextHandoffParser implements ITurnResultParser {
  parse(
    _structuredResults: StructuredToolResult[],
    fullResponse: string,
    persistedContent: string,
    ctx: OrchestratorContext,
  ): Partial<TurnResult> | null {
    const textHandoff = parseHandoffDirective(fullResponse);
    if (!textHandoff) return null;

    const target = resolveNonSelfAgent(textHandoff.targetAgentId, ctx);

    // Ignore invalid or self-targeting handoff directives. This prevents
    // noisy "unknown agent" warnings and self-handoff loops.
    if (!target) {
      return { text: persistedContent, done: false };
    }

    return {
      text: persistedContent,
      done: false,
      handedOff: true,
      handoffTargetId: target.id,
      handoffNote: textHandoff.note || undefined,
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Returns the default ordered set of turn-result parsers. */
export function buildDefaultTurnResultParsers(): ITurnResultParser[] {
  return [
    new HandoffToolResultParser(),
    new TextHandoffParser(),
  ];
}
