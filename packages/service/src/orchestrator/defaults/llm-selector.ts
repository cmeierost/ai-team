/**
 * DefaultLlmSelector — default ILlmSelector.
 * Calls llmService.initializeForChat(agent) to select and initialize the
 * appropriate model/provider for the current agent.
 */

import type { ILlmSelector } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';

export class DefaultLlmSelector implements ILlmSelector {
  async select(ctx: OrchestratorContext): Promise<void> {
    await ctx.llmService.initializeForChat(ctx.agent);
  }
}
