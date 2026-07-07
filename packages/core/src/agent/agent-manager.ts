import { Agent, AgentStatus, AgentSearchOptions, AgentSearchResult } from '../types';
import type { IAgentManager as IAgentManagerBase } from '../types/agent-models.js';

export type RankedAgentResult = {
  agent: Agent;
  /** 0-100 relevance score. */
  score: number;
  /** Which fields contributed to the match. */
  matches: string[];
};

export interface IAgentManager extends IAgentManagerBase {
  rankAgents(query: string | undefined): Promise<RankedAgentResult[]>;
  rankAgentsByIdentity(query: string | undefined): Promise<RankedAgentResult[]>;
  filterAndRankAgents(options: AgentSearchOptions, agents: Agent[]): AgentSearchResult[];

  getAgentsByFeatureAsync(featureId: string): Promise<Agent[]>;

  /**
   * Update agent status
   * @param id - Agent ID
   * @param status - New status
   */
  updateStatusAsync(id: string, status: AgentStatus): Promise<void>;
}
