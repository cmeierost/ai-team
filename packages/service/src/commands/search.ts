import type { IAgentManager, AgentSearchOptions } from '@ai-team/core';
import type { SearchAgentsResponse } from '@ai-team/api-contracts';

export class SearchAgentsCommand {
  constructor(private readonly agentManager: IAgentManager) {}

  async execute(options: AgentSearchOptions): Promise<SearchAgentsResponse> {
    const results = await this.agentManager.searchAgentsAsync(options);
    return { results, totalCount: results.length };
  }
}
