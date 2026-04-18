/**
 * send-turn.ts — compatibility wrapper for one full turn.
 *
 * NOTE: Implementation has been decomposed into explicit lifecycle steps in
 * `send-turn-steps.ts` so it can be executed by a dedicated XState sub-machine.
 */

import type { StructuredToolResult } from '@ai-team/infrastructure';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins, TurnResult } from './pipeline.js';
import {
  ensureTurnStartAsync,
  finalizeTurnResultAsync,
  handleLlmFailureAsync,
  invokeTurnLlmAsync,
  parseTurnResultAsync,
  persistAssistantMessageAsync,
  persistUserMessageAsync,
  prepareMessagesAsync,
  resolveSkillsAndToolsAsync,
} from './send-turn-steps.js';

export interface SendTurnOptions {
  /**
   * When true the user message is injected into the LLM context but NOT
   * persisted to the session store.  Used for synthetic / system-generated
   * prompts (e.g. post-handoff auto-react) that should never appear in the DB.
   */
  skipPersist?: boolean;
}

export async function sendTurn(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: OrchestratorContext,
  options?: SendTurnOptions
): Promise<TurnResult> {
  await ensureTurnStartAsync(userMessage, plugins, ctx, options);
  await persistUserMessageAsync(userMessage, ctx, options);

  const messages = await prepareMessagesAsync(userMessage, plugins, ctx);
  const resolved = await resolveSkillsAndToolsAsync(userMessage, plugins, ctx);

  let fullResponse = '';
  let structuredResults: StructuredToolResult[] = [];

  try {
    const invoked = await invokeTurnLlmAsync(messages, resolved, ctx);
    fullResponse = invoked.fullResponse;
    structuredResults = invoked.structuredResults;
  } catch (error) {
    return handleLlmFailureAsync(error, plugins, ctx, options, structuredResults);
  }

  process.stdout.write('\n');

  const persisted = await persistAssistantMessageAsync(fullResponse, plugins, ctx);
  const parsed = await parseTurnResultAsync(
    structuredResults,
    fullResponse,
    persisted.persistedContent,
    plugins,
    ctx
  );

  const turnResult: TurnResult = parsed ?? { text: persisted.persistedContent, done: false };
  return finalizeTurnResultAsync(
    turnResult,
    fullResponse,
    persisted.persistedContent,
    structuredResults,
    plugins,
    ctx
  );
}

export { buildRetryableFailureMessage } from './send-turn-steps.js';
