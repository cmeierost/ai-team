import type { ExecutionContext } from '@ai-team/core';
/**
 * NoOpRagProvider — default IRagProvider.
 * Returns null (no retrieval). Swap with an embedding-based implementation
 * without touching the orchestrator.
 *
 * When implemented: MUST scope retrieval to contextManager.getReadablePaths(agent).
 * Returning content from files the agent cannot read is a permission violation.
 */

import type { IRagProvider } from '../pipeline.js';

export class NoOpRagProvider implements IRagProvider {
  async retrieve(_query: string, _ctx: ExecutionContext): Promise<null> {
    return null;
  }
}
