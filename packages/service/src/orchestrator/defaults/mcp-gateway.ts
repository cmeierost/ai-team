/**
 * NoOpMcpGateway — default IMcpGateway.
 * Returns no external tools. Swap with an MCP server discovery implementation
 * without touching the orchestrator.
 */

import type { AgentTool } from '@ai-team/core';
import type { IMcpGateway } from '../pipeline.js';

export class NoOpMcpGateway implements IMcpGateway {
  async discover(): Promise<AgentTool[]> {
    return [];
  }
}
