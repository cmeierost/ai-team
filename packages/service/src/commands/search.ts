/**
 * Agent search command
 */

import { AgentManager } from '@ai-team/infrastructure';
import type { AgentSearchOptions } from '@ai-team/infrastructure';
import type { SearchAgentsResponse } from '@ai-team/api-client';

/**
 * Search for agents with fuzzy matching and filtering
 */
export async function searchAgentsCommand(
  workspaceRoot: string,
  options: AgentSearchOptions
): Promise<SearchAgentsResponse> {
  const agentManager = new AgentManager(workspaceRoot);
  const results = await agentManager.searchAgentsAsync(options);
  return { results, totalCount: results.length };
}
