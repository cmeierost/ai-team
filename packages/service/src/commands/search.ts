/**
 * Agent search command
 */

import { AgentManager } from '@ai-team/core';
import type {
  AgentSearchOptions,
  AgentSearchResult,
} from '@ai-team/core';

/**
 * Search for agents with fuzzy matching and filtering
 */
export async function searchAgentsCommand(
  workspaceRoot: string,
  options: AgentSearchOptions
): Promise<AgentSearchResult[]> {
  const agentManager = new AgentManager(workspaceRoot);
  await agentManager.initialize();
  
  return agentManager.searchAgents(options);
}
