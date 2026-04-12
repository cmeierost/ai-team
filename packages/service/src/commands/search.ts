/**
 * Agent search command
 */

import { AgentManager } from '@ai-team/infrastructure';
import type {
  AgentSearchOptions,
  AgentSearchResult,
} from '@ai-team/infrastructure';

/**
 * Search for agents with fuzzy matching and filtering
 */
export async function searchAgentsCommand(
  workspaceRoot: string,
  options: AgentSearchOptions
): Promise<AgentSearchResult[]> {
  const agentManager = new AgentManager(workspaceRoot);
  
  return agentManager.searchAgentsAsync(options);
}
