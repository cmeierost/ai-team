/**
 * Chat command public surface.
 *
 * Implementation lives in chat.command.ts.
 * Supporting modules:
 *   hooks.ts            — ChatRuntimeHooks interface (the caller's contract)
 *   emit.ts             — emitRuntimeEvent / writeInfo / writeWarn / writeError
 *   questions.ts        — requestInput / requestSelect
 *   chat-info-service.ts — session intro / history display
 *   chat-preflight-service.ts — workspace / identity pre-flight checks
 */

// ── Service modules ───────────────────────────────────────────────────────────
export type { ChatRuntimeHooks } from '../../orchestrator/hooks.js';
export { formatConsoleArgs } from '../../orchestrator/services/emit-service.js';
export { requestInput, requestSelect } from '../com/questions.js';
export { ChatInfoService } from '../../orchestrator/chat-info-service.js';
export type { IChatInfoService } from '../../orchestrator/chat-info-service.js';
export { ChatPreflightService } from '../../orchestrator/chat-preflight-service.js';
export type { IChatPreflightService } from '../../orchestrator/chat-preflight-service.js';
export { InfoChatCommand } from '../agents/info.command.js';

// ── Implementation ────────────────────────────────────────────────────────────
export {
  ChatCommand,
  type ChatConfigIdentityDeps,
  type ChatAgentKnowledgeDeps,
  type ChatSessionExecutionDeps,
  type ChatOrchestrationDeps,
} from './chat.command.js';

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Strip HANDOFF:/FORWARD_TO: directive lines from agent text before persisting. */
export function stripHandoffDirective(text: string): string {
  let cleaned = text.replaceAll(/\s*(?:HANDOFF|FORWARD_TO):\s*[^|\n]+(?:\s*\|\s*[^\n]*)?/gim, '');
  cleaned = cleaned.replaceAll(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

/**
 * Parse a HANDOFF: directive from agent response text.
 *
 * Matches: `HANDOFF: <agentId> | <optional note>`
 *          `FORWARD_TO: <agentId> | <optional note>`
 *
 * Returns the parsed fields, or null if no directive is present.
 */
export function parseHandoffDirective(
  text: string
): { targetAgentId: string; note: string } | null {
  // Allow spaces in the agent name — LLMs write "Emily Davis", not "emily-davis".
  const re =
    /(?:^|\n)\s*(?:HANDOFF|FORWARD_TO):\s*([^|\n]+?)\s*(?:\|\s*([^\n]*?))?\s*(?:$|\n)|\s+(?:HANDOFF|FORWARD_TO):\s*([^|\n]+?)\s*(?:\|\s*([^\n]*?))?\s*$/im;
  const match = re.exec(text);
  if (!match) return null;
  const target = (match[1] ?? match[3] ?? '').trim();
  const note = (match[2] ?? match[4] ?? '').trim();
  if (!target) return null;
  return { targetAgentId: target, note };
}

export const CHAT_COMMAND_META = {
  description: 'Start a chat session with an agent (defaults to top-level manager if omitted)',
  llmCallable: false,
};
