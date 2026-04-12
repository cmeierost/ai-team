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
import type { AgentManager, Agent, LlmService, ChatMessage } from '@ai-team/infrastructure';

const FORWARD_PATTERNS = [
  /(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|over\s+to)\s+(.+)/i,
  /(?:let me|i(?:'d| would) like to)\s+(?:talk|speak|chat)\s+(?:to|with)\s+(.+)/i,
  /(?:can (?:you|i)|please)\s+(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|with)\s+(.+)/i,
  /(?:put me through|patch me through|hand me off)\s+(?:to)\s+(.+)/i,
  /(?:i (?:want|need) to (?:talk|speak|chat) (?:to|with))\s+(.+)/i,
  /(?:get me)\s+(.+)/i,
  /(?:i(?:'d| would) rather ask)\s+(.+?)(?:\s+(?:about|on|regarding|with)\b.*)?$/i,
  /(?:can (?:you|i)|please|could you)?\s*brief\s+(.+?)(?:\s+(?:about|on|regarding|with)\b.*)?$/i,
  /(?:tell|inform|update|notify)\s+(.+?)\s+(?:about|on|regarding)\b/i,
  /let\s+(.+?)\s+know\b/i,
  /(?:loop\s+in|bring\s+in|include)\s+(.+)/i,
  /ping\s+(.+?)(?:\s+(?:about|on|regarding)\b.*)?$/i,
];

const FORWARD_TARGET_ALIASES: Record<string, string[]> = {
  ceo: ['ceo', 'cto', 'chief executive officer'],
  cto: ['cto', 'ceo', 'chief technology officer'],
  'hr director': ['hr director', 'hr', 'human resources', 'head of human resources'],
};

async function resolveForwardTargetCandidatesAsync(
  target: string,
  agentManager: AgentManager,
  currentAgentId: string,
): Promise<Agent[]> {
  const normalized = target.trim().toLowerCase();
  const queries = new Set<string>([normalized]);

  for (const [aliasKey, aliasValues] of Object.entries(FORWARD_TARGET_ALIASES)) {
    if (aliasValues.includes(normalized)) {
      queries.add(aliasKey);
      for (const alias of aliasValues) queries.add(alias);
    }
  }

  const seen = new Set<string>();
  const resolved: Agent[] = [];
  for (const query of queries) {
    const matches = await agentManager.resolveAgentAsync(query);
    for (const candidate of matches) {
      if (candidate.id === currentAgentId || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      resolved.push(candidate);
    }
  }

  return resolved;
}

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

async function detectForwardRequestAsync(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
): Promise<Agent | undefined> {
  const target = extractForwardTargetName(message);
  if (!target) return undefined;
  const resolved = await resolveForwardTargetCandidatesAsync(target, agentManager, currentAgentId);
  return resolved.length > 0 ? resolved[0] : undefined;
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
export async function detectForwardRequestWithFallbackAsync(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
  llm: LlmService,
  agent: Agent,
  history: ChatMessage[] = [],
): Promise<{ resolved: Agent | undefined; looksLikeForward: boolean }> {
  // Phase 1: exact/fuzzy regex match
  const direct = await detectForwardRequestAsync(message, agentManager, currentAgentId);
  if (direct) return { resolved: direct, looksLikeForward: true };

  const rawTarget = extractForwardTargetName(message);
  if (!rawTarget) return { resolved: undefined, looksLikeForward: false };

  const isPronouns = REFERENCE_PRONOUNS.has(rawTarget.toLowerCase().trim());

  // Phase 2: shorter word-prefix slices (handles "forward me to alex i want to discuss…")
  if (!isPronouns) {
    const words = rawTarget.trim().split(/\s+/);
    for (let len = words.length - 1; len >= 1; len--) {
      const candidate = words.slice(0, len).join(' ');
      const matches = (await agentManager.resolveAgentAsync(candidate)).filter(a => a.id !== currentAgentId);
      if (matches.length > 0) return { resolved: matches[0], looksLikeForward: true };
    }
  }

  // Phase 3: LLM fallback — let the model identify the target from the roster.
  // Always include recent conversation history so pronouns and implicit references
  // ("her", "him", "the one you mentioned") can be resolved from context.
  const candidates = (await agentManager.getAllAgentsAsync()).filter(a => a.id !== currentAgentId);
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
        const matches = (await agentManager.resolveAgentAsync(answer)).filter(a => a.id !== currentAgentId);
        if (matches.length > 0) return { resolved: matches[0], looksLikeForward: true };
      }
    } catch {
      // LLM fallback failed — fall through
    }
  }

  return { resolved: undefined, looksLikeForward: true };
}
