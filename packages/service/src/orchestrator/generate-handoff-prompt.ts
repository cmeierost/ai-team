import type { Agent } from '@ai-team/infrastructure';
import { LlmService } from '@ai-team/infrastructure';

/**
 * Generates a default handoff prompt from one agent to another using the LLM.
 * The prompt is written from the FROM agent's perspective: what work should the
 * TO agent take on, and what context matters for their role.
 *
 * Falls back to a generic prompt if the LLM is unavailable.
 */
export async function generateDefaultHandoffPrompt(
  llm: LlmService,
  fromAgent: Agent,
  toAgent: Agent,
): Promise<string> {
  const fromTitle = fromAgent.role
    ? `${fromAgent.name} (${fromAgent.role})`
    : fromAgent.name;
  const toTitle = toAgent.role
    ? `${toAgent.name} (${toAgent.role})`
    : toAgent.name;

  const fromContext = fromAgent.description ?? '';
  const toContext = toAgent.description ?? '';

  const systemPrompt = `You are ${fromTitle}.${fromContext ? ` ${fromContext}` : ''}`;

  const userMessage =
    `Write a 1-2 sentence routing instruction to be sent to ${toTitle} when you hand off a task to them.` +
    (toContext ? ` ${toAgent.name}'s responsibilities: ${toContext}` : '') +
    `\n\nThe instruction should:` +
    `\n- Be written in second person, addressed to ${toAgent.name}` +
    `\n- Be specific to their role and what kind of work they should own` +
    `\n- Not include a greeting, subject line, or sign-off` +
    `\n\nReply with only the instruction text.`;

  try {
    const reply = await llm.rawChat(systemPrompt, [{ role: 'user', content: userMessage }], {
      maxTokens: 150,
    });
    return reply.trim();
  } catch {
    return `Please take this on within your area of responsibility as ${toTitle}.`;
  }
}
