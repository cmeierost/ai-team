/**
 * NoOpCompressor — default IContextCompressor.
 * Returns history unchanged. Swap with a real implementation when you need
 * summarization or importance-weighted pruning without touching the orchestrator.
 */

import type { ChatMessage } from '@ai-team/core';
import type { IContextCompressor } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';

export class NoOpCompressor implements IContextCompressor {
  async compress(history: ChatMessage[], _ctx: OrchestratorContext): Promise<ChatMessage[]> {
    return history;
  }
}
