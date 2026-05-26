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

import {
  isHandoffRequest,
  type Agent,
  type IAgentManager,
  type StructuredToolResult,
  ExecutionContext,
} from '@ai-team/core';
import type { ITurnResultParser, TurnResult } from '../pipeline.js';
import { parseHandoffDirective } from '../../commands/chat/index.js';
import { getServiceContainer } from '../../service-registry.js';
import { COMMAND_FACTORY_TOKENS } from '../../types.js';

// ── Shared agent resolution helper ────────────────────────────────────────────

function resolveAgentManager(): IAgentManager {
  return getServiceContainer().resolve(COMMAND_FACTORY_TOKENS.AgentManager);
}

/**
 * Resolves a target agent ID to an Agent that is not the current agent.
 * Tries exact lookup first, then fuzzy resolution via resolveAgent.
 * Returns undefined when no valid non-self target can be found.
 */
function resolveNonSelfAgent(
  targetId: string,
  ctx: ExecutionContext,
  agentManager: IAgentManager
): Agent | undefined {
  const getAgent = (agentManager as { getAgent?: (query: string) => Agent | undefined }).getAgent;
  const resolveAgent = (agentManager as { resolveAgent?: (query: string) => Agent[] }).resolveAgent;

  const exact = typeof getAgent === 'function' ? getAgent.call(agentManager, targetId) : undefined;

  if (exact && exact.id !== ctx.agent!.id) return exact;

  return typeof resolveAgent === 'function'
    ? resolveAgent.call(agentManager, targetId).find((a) => a.id !== ctx.agent!.id)
    : undefined;
}

// ── 1. Handoff from tool call ─────────────────────────────────────────────────

export class HandoffToolResultParser implements ITurnResultParser {
  constructor(private readonly agentManager?: IAgentManager) {}

  parse(
    structuredResults: StructuredToolResult[],
    _fullResponse: string,
    persistedContent: string,
    ctx: ExecutionContext
  ): Partial<TurnResult> | null {
    const handoffReq = structuredResults.find(isHandoffRequest);
    if (!handoffReq || !isHandoffRequest(handoffReq)) return null;

    const target = resolveNonSelfAgent(
      handoffReq.targetAgentId,
      ctx,
      this.agentManager ?? resolveAgentManager()
    );

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
  constructor(private readonly agentManager?: IAgentManager) {}

  parse(
    _structuredResults: StructuredToolResult[],
    fullResponse: string,
    persistedContent: string,
    ctx: ExecutionContext
  ): Partial<TurnResult> | null {
    const textHandoff = parseHandoffDirective(fullResponse);
    if (!textHandoff) return null;

    const target = resolveNonSelfAgent(
      textHandoff.targetAgentId,
      ctx,
      this.agentManager ?? resolveAgentManager()
    );

    // Ignore invalid or self-targeting handoff directives.
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
  return [new HandoffToolResultParser(), new TextHandoffParser()];
}
