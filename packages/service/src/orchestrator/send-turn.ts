/**
 * send-turn.ts — compatibility wrapper for one full turn.
 *
 * NOTE: Implementation has been decomposed into explicit lifecycle steps in
 * `send-turn-steps.ts` so it can be executed by a dedicated XState sub-machine.
 */

import type { StructuredToolResult, ExecutionContext } from '@ai-team/core';
import type { ResolvedPlugins, TurnResult } from './pipeline.js';
import {
  buildRetryableFailureMessage as buildRetryableFailureMessageImpl,
  ensureTurnStartAsync,
  finalizeTurnResultAsync,
  handleLlmFailureAsync,
  invokeTurnLlmAsync,
  parseTurnResultAsync,
  persistAssistantMessageAsync,
  persistUserMessageAsync,
  prepareMessagesAsync,
  resolveSkillsAndToolsAsync,
  type SendTurnDeps,
} from './send-turn-steps.js';
import { EmitService } from './services/emit-service.js';

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
  ctx: ExecutionContext,
  options?: SendTurnOptions,
  deps?: SendTurnDeps
): Promise<TurnResult> {
  // Build deps from ctx when not provided (compatibility path used by tests and
  // callers that still embed services directly on the context object).
  const ctxAny = ctx as any;
  const resolvedDeps: SendTurnDeps = deps ?? {
    sessionManager: ctxAny.sessionManager,
    llmService: ctxAny.llmService,
    skillManager: ctxAny.skillManager,
    hooks: ctxAny.hooks ?? {},
    emitService:
      ctxAny.hooks?.emitService ?? new EmitService(ctxAny.hooks?.emit ?? ctxAny.emit ?? (() => {})),
  };

  await ensureTurnStartAsync(userMessage, plugins, ctx, options, resolvedDeps);
  await persistUserMessageAsync(userMessage, ctx, options, resolvedDeps);

  const messages = await prepareMessagesAsync(userMessage, plugins, ctx, resolvedDeps);
  const resolved = await resolveSkillsAndToolsAsync(userMessage, plugins, ctx, resolvedDeps);

  let fullResponse = '';
  let structuredResults: StructuredToolResult[] = [];

  try {
    const invoked = await invokeTurnLlmAsync(messages, resolved, ctx, resolvedDeps);
    fullResponse = invoked.fullResponse;
    structuredResults = invoked.structuredResults;
  } catch (error) {
    return handleLlmFailureAsync(error, plugins, ctx, options, structuredResults, resolvedDeps);
  }

  process.stdout.write('\n');

  const persisted = await persistAssistantMessageAsync(fullResponse, plugins, ctx, resolvedDeps);
  const parsed = await parseTurnResultAsync(
    structuredResults,
    fullResponse,
    persisted.persistedContent,
    plugins,
    ctx,
    resolvedDeps
  );

  const turnResult: TurnResult = parsed ?? { text: persisted.persistedContent, done: false };
  return finalizeTurnResultAsync(
    turnResult,
    fullResponse,
    persisted.persistedContent,
    structuredResults,
    plugins,
    ctx,
    resolvedDeps
  );
}

export const buildRetryableFailureMessage = buildRetryableFailureMessageImpl;
