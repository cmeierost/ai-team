/**
 * NoOpRagProvider — default IRagProvider.
 * Returns null (no retrieval). Swap with an embedding-based implementation
 * without touching the orchestrator.
 *
 * When implemented: MUST scope retrieval to contextManager.getReadablePaths(agent).
 * Returning content from files the agent cannot read is a permission violation.
 */

import type { IRagProvider } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';

export class NoOpRagProvider implements IRagProvider {
  async retrieve(_query: string, _ctx: OrchestratorContext): Promise<null> {
    return null;
  }
}
