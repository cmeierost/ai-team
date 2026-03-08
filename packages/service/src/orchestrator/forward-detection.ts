/**
 * Natural-language forward / switch detection.
 *
 * Moved here (orchestrator layer) so it can be used by ChatOrchestrator —
 * making NL forward detection available to all callers (CLI, VS Code, API)
 * rather than only the CLI interactive loop.
 *
 * Resolution strategy — three phases:
 *   1. Regex extraction + AgentManager fuzzy match
 *   2. Progressively shorter word-prefix slices of the extracted name
 *   3. LLM fallback (ask the model which roster entry the user means)
 */
import type { AgentManager, Agent, LlmService, ChatMessage } from '@ai-team/core';

const FORWARD_PATTERNS = [
  /(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|over\s+to)\s+(.+)/i,
  /(?:let me|i(?:'d| would) like to)\s+(?:talk|speak|chat)\s+(?:to|with)\s+(.+)/i,
  /(?:can (?:you|i)|please)\s+(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|with)\s+(.+)/i,
  /(?:put me through|patch me through|hand me off)\s+(?:to)\s+(.+)/i,
  /(?:i (?:want|need) to (?:talk|speak|chat) (?:to|with))\s+(.+)/i,
  /(?:can (?:you|i)|please|could you)?\s*brief\s+(.+?)(?:\s+(?:about|on|regarding|with)\b.*)?$/i,
  /(?:tell|inform|update|notify)\s+(.+?)\s+(?:about|on|regarding)\b/i,
  /let\s+(.+?)\s+know\b/i,
  /(?:loop\s+in|bring\s+in|include)\s+(.+)/i,
  /ping\s+(.+?)(?:\s+(?:about|on|regarding)\b.*)?$/i,
];

function extractForwardTargetName(message: string): string | undefined {
  for (const pattern of FORWARD_PATTERNS) {
    const match = message.match(pattern);
    if (!match) continue;
    let target = match[1].replace(/[?.!,]+$/, '').replace(/^the\s+/i, '').trim();
    if (!target) continue;
    target = target.replace(/\b(?:and|but|so|then|because|while|plus)\b.*$/i, '').trim();
    target = target.replace(/\b(?:please|thanks|thank you)\b.*$/i, '').trim();
    if (target) return target;
  }
  return undefined;
}

/**
 * Extract any trailing context from a forward request after stripping the
 * directive and the agent name.
 *
 * e.g. "forward me to michael about the budget" → "about the budget"
 *      "forward me to michael"                  → undefined
 */
export function extractForwardNote(message: string, agentName: string): string | undefined {
  const trimmedMsg = message.trim();

  // Try full name first (e.g. "Michael Brown")
  const nameEscaped = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let afterName = message.replace(new RegExp(`^.*?${nameEscaped}`, 'i'), '').trim();

  // If full name wasn't found, try individual name parts (first name, last name)
  // so "connect me to michael" matches agent "Michael Brown".
  if (afterName === trimmedMsg) {
    const nameParts = agentName.split(/\s+/).filter(p => p.length >= 2);
    for (const part of nameParts) {
      const partEscaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const result = message.replace(new RegExp(`^.*?${partEscaped}`, 'i'), '').trim();
      if (result !== trimmedMsg) {
        afterName = result;
        break;
      }
    }
  }

  // Nothing matched — no trailing context to extract
  if (afterName === trimmedMsg) return undefined;

  // Strip leading punctuation / conjunctions
  const note = afterName.replace(/^[,;:\s]+/, '').trim();
  return note.length > 0 ? note : undefined;
}

function detectForwardRequest(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
): Agent | undefined {
  const target = extractForwardTargetName(message);
  if (!target) return undefined;
  const matches = agentManager.resolveAgent(target);
  const filtered = matches.filter(a => a.id !== currentAgentId);
  return filtered.length > 0 ? filtered[0] : undefined;
}

/** Third-person pronouns and vague references that cannot be resolved without context. */
export const REFERENCE_PRONOUNS = new Set([
  'him', 'her', 'them', 'they', 'he', 'she',
  'that person', 'this person', 'that agent', 'the agent',
  'that team member', 'this team member', 'that one', 'this one',
]);

/**
 * Detect if the user's message is asking to be forwarded to another agent,
 * with three-phase fallback (regex → word-prefix slices → LLM).
 */
export async function detectForwardRequestWithFallback(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
  llm: LlmService,
  agent: Agent,
  history: ChatMessage[] = [],
): Promise<{ resolved: Agent | undefined; looksLikeForward: boolean }> {
  // Phase 1: exact/fuzzy regex match
  const direct = detectForwardRequest(message, agentManager, currentAgentId);
  if (direct) return { resolved: direct, looksLikeForward: true };

  const rawTarget = extractForwardTargetName(message);
  if (!rawTarget) return { resolved: undefined, looksLikeForward: false };

  const isPronouns = REFERENCE_PRONOUNS.has(rawTarget.toLowerCase().trim());

  // Phase 2: shorter word-prefix slices (handles "forward me to alex i want to discuss…")
  if (!isPronouns) {
    const words = rawTarget.trim().split(/\s+/);
    for (let len = words.length - 1; len >= 1; len--) {
      const candidate = words.slice(0, len).join(' ');
      const matches = agentManager.resolveAgent(candidate).filter(a => a.id !== currentAgentId);
      if (matches.length > 0) return { resolved: matches[0], looksLikeForward: true };
    }
  }

  // Phase 2.5: pronoun resolution from history.
  // Walk history newest-first; return the first agent whose name appears in any message.
  // Handles "forward me to him" when the conversation just mentioned "Michael" two turns ago.
  if (isPronouns && history.length > 0) {
    const allCandidates = agentManager.getAllAgents().filter(a => a.id !== currentAgentId);
    for (const msg of [...history].reverse()) {
      const content = (msg.content ?? '').toLowerCase();
      for (const candidate of allCandidates) {
        const nameParts = candidate.name.toLowerCase().split(/\s+/).filter(p => p.length >= 3);
        if (nameParts.some(p => content.includes(p))) {
          return { resolved: candidate, looksLikeForward: true };
        }
      }
    }
  }

  // Phase 3: LLM fallback — let the model identify the target from the roster.
  // Always include recent conversation history so pronouns and implicit references
  // ("her", "him", "the one you mentioned") can be resolved from context.
  const candidates = agentManager.getAllAgents().filter(a => a.id !== currentAgentId);
  if (candidates.length > 0) {
    try {
      const nameList = candidates.map(a => `${a.name} (${a.role})`).join(', ');
      let contextBlock = '';
      if (history.length > 0) {
        const recentTurns = history.slice(-6);
        contextBlock =
          '\nRecent conversation (last few messages):\n'
          + recentTurns.map(m => `${m.isHuman ? 'Developer' : m.from}: ${m.content}`).join('\n')
          + '\n';
      }
      const pronounHint = isPronouns
        ? `The word "${rawTarget}" is a pronoun — use the conversation history to identify who it refers to.\n`
        : '';
      const reply = await llm.chat(
        agent,
        [{
          role: 'user',
          content:
            `The developer said: "${message}"\n`
            + pronounHint
            + contextBlock
            + `\nWhich of these team members are they referring to? Options: ${nameList}\n`
            + 'Reply with just the exact name from the list, or "none" if it is unclear.',
        }],
        { maxTokens: 20 },
      );
      const answer = reply.trim().replace(/^["']|["'.!?]$/g, '');
      if (answer.toLowerCase() !== 'none' && answer.length > 0) {
        const matches = agentManager.resolveAgent(answer).filter(a => a.id !== currentAgentId);
        if (matches.length > 0) return { resolved: matches[0], looksLikeForward: true };
      }
    } catch {
      // LLM fallback failed — fall through
    }
  }

  return { resolved: undefined, looksLikeForward: true };
}
