/**
 * handoff.ts — full handoff sequence for ChatOrchestrator.
 *
 * Implements the six-step handoff protocol:
 *  1. Resolve the TO session (spine-aware — one session per agent per thread).
 *  2. Generate a fresh handoffId UUID.
 *  3. Write the parentNote to the FROM session with handoff columns stamped.
 *  4. Generate an LLM briefing in the FROM agent's voice, write to TO session.
 *  5. Emit the handoff runtime event with full fields.
 *  6. Mutate ctx so the next turn runs as the TO agent.
 *
 * Extracted here because the handoff logic is complex enough to deserve its
 * own module, keeping ChatOrchestrator focused on turn management.
 */

import { randomUUID } from 'node:crypto';
import type { Agent, ChatMessage } from '@ai-team/infrastructure';
import { emitEvent, emitLog } from './stream-events.js';
import { detectForwardRequestWithFallbackAsync, extractForwardNote } from './forward-detection.js';
import type { OrchestratorContext } from './pipeline-context.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect if the message is a natural-language request to be forwarded to
 * another agent and, if so, execute the handoff.
 *
 * Returns an empty string if a forward was handled (or a near-miss warning
 * was emitted), null if the message is not a forward request at all.
 */
export async function tryNlForward(
  message: string,
  ctx: OrchestratorContext,
): Promise<string | null> {
  const { resolved, looksLikeForward } = await detectForwardRequestWithFallbackAsync(
    message,
    ctx.agentManager,
    ctx.agent.id,
    ctx.llmService,
    ctx.agent,
    ctx.history,
  );

  if (resolved) {
    // Persist the user's message before the handoff — sendTurn never runs
    // on this path, so this is the only place to record the human input.
    const userMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: ctx.agent.id,
      isHuman: true,
      content: message,
    };
    await ctx.sessionManager.appendMessage(ctx.sessionId, userMsg);
    ctx.history.push(userMsg);

    const note = extractForwardNote(message, resolved.name);
    await executeHandoff(ctx, resolved.id, undefined, note);
    emitLog(ctx.hooks, 'info', `\nSwitching to ${resolved.name} (${resolved.role})...\n`);
    return 'forwarded';
  }

  if (looksLikeForward) {
    emitLog(
      ctx.hooks,
      'warn',
      `I couldn't find anyone on your team matching that request. Try using their name directly.`,
    );
    // Return null so the message still flows through sendTurn — it gets
    // persisted to the DB and the current agent processes the content.
    return null;
  }

  return null;
}

/**
 * Execute the full handoff sequence.
 *
 * Mutates `ctx` in place (agent, sessionId, history) so the next turn
 * runs as the target agent. Returns `true` if the handoff succeeded,
 * `false` if the target agent does not exist or the target session
 * could not be resolved.
 */
export async function executeHandoff(
  ctx: OrchestratorContext,
  targetAgentId: string,
  targetSessionId?: string,
  handoffNote?: string,
): Promise<boolean> {
  // getAgent uses exact ID matching; fall back to fuzzy resolveAgent so LLMs
  // that write "Emily Davis" (name) instead of "emily-davis" (id) still work.
  const target =
    await ctx.agentManager.getAgentAsync(targetAgentId)
    ?? (await ctx.agentManager.resolveAgentAsync(targetAgentId)).find(a => a.id !== ctx.agent.id);
  if (!target) return false;

  const currentSession = await ctx.sessionManager.getSession(ctx.sessionId);
  const developerId = currentSession?.developerId ?? 'unknown';
  const fromSessionId = ctx.sessionId;
  const fromAgent: Agent = ctx.agent;

  // ── 1. Resolve the TO session (spine-aware) ─────────────────────────────
  let toSessionId: string;
  if (targetSessionId) {
    // Pre-resolved by the handoff_to_agent tool — just validate it exists.
    const pre = await ctx.sessionManager.getSession(targetSessionId);
    if (!pre) return false;
    toSessionId = pre.id;
  } else {
    // Use target.id (the canonical agent ID) — not the raw targetAgentId
    // which may be a display name like "Emily Davis" from an LLM directive.
    const { session } = await ctx.sessionManager.resolveHandoffSession(
      target.id,
      fromSessionId,
      developerId,
    );
    toSessionId = session.id;
  }

  // ── 2. Generate handoff ID ───────────────────────────────────────────────
  const handoffId = randomUUID();

  // ── 3. LLM briefing → BOTH sessions ─────────────────────────────────────
  // A single briefing message carries BOTH handoffFromSessionId and
  // handoffToSessionId so that either session can navigate to the other.
  const briefingContent = await generateHandoffBriefing(
    ctx,
    fromAgent,
    target,
    developerId,
    handoffNote ?? '',
  );
  const briefingMsg: ChatMessage = {
    from: fromAgent.id,
    to: target.id,
    content: briefingContent,
    timestamp: new Date().toISOString(),
    isHuman: false,
    handoffType: 'agent-briefing',
    handoffFromSessionId: fromSessionId,
    handoffToSessionId: toSessionId,
    handoffId,
  };
  // Write to TO session
  const history = await ctx.sessionManager.getSessionMessages(toSessionId);
  history.push(briefingMsg);
  await ctx.sessionManager.appendMessage(toSessionId, briefingMsg);

  // Write briefing to FROM session so the source thread also has it
  await ctx.sessionManager.appendMessage(fromSessionId, briefingMsg);

  // ── 5. Emit handoff event ────────────────────────────────────────────────
  emitEvent(ctx.hooks, {
    kind: 'handoff',
    fromAgentId: fromAgent.id,
    fromAgentName: fromAgent.name,
    fromAgentRole: fromAgent.role,
    fromSessionId,
    toAgentId: target.id,
    toAgentName: target.name,
    toAgentRole: target.role,
    toSessionId,
    handoffNote,
    briefingContent,
  });

  // ── 6. Mutate context ────────────────────────────────────────────────────
  (ctx as any).agent     = target;
  (ctx as any).sessionId = toSessionId;
  (ctx as any).history   = history;

  return true;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Generate a handoff briefing note written in the FROM agent's voice.
 *
 * Uses recent conversation history so the briefing reflects what was
 * actually discussed. Falls back to the raw trigger message if the LLM
 * call fails.
 */
async function generateHandoffBriefing(
  ctx: OrchestratorContext,
  fromAgent: Agent,
  toAgent: Agent,
  developerName: string,
  triggerMessage: string,
): Promise<string> {
  try {
    const recentHistory = ctx.history.slice(-12);
    const historyText = recentHistory
      .map(m => `${m.isHuman ? developerName : m.from}: ${m.content}`)
      .join('\n');

    const agentTitle = fromAgent.role
      ? `${fromAgent.name} (${fromAgent.role})`
      : fromAgent.name;

    const reply = await ctx.llmService.chat(
      fromAgent,
      [{
        role: 'user',
        content:
          `You are ${agentTitle}. `
          + `Write a handoff briefing for ${toAgent.name}.\n`
          + (triggerMessage ? `${developerName} said: "${triggerMessage}"\n\n` : '')
          + (historyText ? `Recent conversation:\n${historyText}\n\n` : '')
          + `Write 2-10 sentences in first person as ${fromAgent.name}: summarise what you and `
          + `${developerName} discussed, what ${developerName}'s goal is, and why you are `
          + `forwarding them to ${toAgent.name}. `
          + `Do not repeat the request word-for-word. Do not add a subject line or greeting.`,
      }],
      { maxTokens: 250 },
    );
    return reply.trim();
  } catch {
    // LLM unavailable — fall back to the raw trigger message.
    return triggerMessage || `Handoff from ${fromAgent.name} to ${toAgent.name}.`;
  }
}
