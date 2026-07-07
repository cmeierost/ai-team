/**
 * send-turn.ts — compatibility wrapper for one full turn.
 *
 * NOTE: Implementation has been decomposed into explicit lifecycle steps in
 * `send-turn-steps.ts` so it can be executed by a dedicated XState sub-machine.
 */

import type { StructuredToolResult, ExecutionContext } from '@ai-team/core';
import type { ResolvedPlugins, TurnResult } from './pipeline.js';
import { SendTurnStepService, type SendTurnOptions, type SendTurnDeps } from './send-turn-steps.js';

export class SendTurnService {
  constructor(private readonly deps: SendTurnDeps) {}

  async run(
    userMessage: string,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext,
    options?: SendTurnOptions
  ): Promise<TurnResult> {
    const steps = new SendTurnStepService(this.deps);

    await steps.ensureTurnStartAsync(userMessage, plugins, ctx, options);
    await steps.persistUserMessageAsync(userMessage, ctx, options);

    const messages = await steps.prepareMessagesAsync(userMessage, plugins, ctx);
    const resolved = await steps.resolveSkillsAndToolsAsync(userMessage, plugins, ctx);

    let fullResponse = '';
    let structuredResults: StructuredToolResult[] = [];

    try {
      const invoked = await steps.invokeTurnLlmAsync(messages, resolved, ctx);
      fullResponse = invoked.fullResponse;
      structuredResults = invoked.structuredResults;
    } catch (error) {
      return steps.handleLlmFailureAsync(error, plugins, ctx, options, structuredResults);
    }

    process.stdout.write('\n');

    const persisted = await steps.persistAssistantMessageAsync(fullResponse, plugins, ctx);
    const parsed = await steps.parseTurnResultAsync(
      structuredResults,
      fullResponse,
      persisted.persistedContent,
      plugins,
      ctx
    );

    const turnResult: TurnResult = parsed ?? { text: persisted.persistedContent, done: false };
    return steps.finalizeTurnResultAsync(
      turnResult,
      fullResponse,
      persisted.persistedContent,
      structuredResults,
      plugins,
      ctx
    );
  }
}

export async function sendTurn(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  options?: SendTurnOptions,
  deps?: SendTurnDeps
): Promise<TurnResult> {
  if (!deps) {
    throw new Error('sendTurn requires explicit SendTurnDeps injection.');
  }

  return new SendTurnService(deps).run(userMessage, plugins, ctx, options);
}

export { buildRetryableFailureMessage } from './send-turn-steps.js';
