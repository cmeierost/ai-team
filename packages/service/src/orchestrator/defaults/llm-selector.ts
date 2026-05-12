/**
 * DefaultLlmSelector — default ILlmSelector.
 * Calls llmService.initializeForChat(agent) to select and initialize the
 * appropriate model/provider for the current agent.
 */

import type { ILlmService, ExecutionContext } from '@ai-team/core';
import type { ILlmSelector } from '../pipeline.js';

export class DefaultLlmSelector implements ILlmSelector {
  constructor(private readonly llmService: ILlmService) {}

  async select(ctx: ExecutionContext): Promise<void> {
    await (
      this.llmService as unknown as { initializeForChat?: (agent: unknown) => Promise<void> }
    ).initializeForChat?.(ctx.agent);
  }
}
