import { Agent, AgentConfig, AgentStatus, AgentSearchOptions, AgentSearchResult } from '../types';
import type {
  AnalyzePermissionOverlapOptions,
  PermissionOverlapReport,
} from '../context/perm-overlap.js';

export type RankedAgentResult = {
  agent: Agent;
  /** 0-100 relevance score. */
  score: number;
  /** Which fields contributed to the match. */
  matches: string[];
};

export interface IAgentManager {
  readonly workspaceRoot: string;
  rankAgents(query: string | undefined): RankedAgentResult[];
  rankAgentsByIdentity(query: string | undefined): RankedAgentResult[];
  filterAndRankAgents(options: AgentSearchOptions, agents: Agent[]): AgentSearchResult[];

  getAgentsAsync(): Promise<Map<string, Agent>>;

  /**
   * Force a full refresh from disk.
   */
  refreshAsync(): Promise<void>;

  /**
   * Get all loaded agents
   */
  getAllAgentsAsync(): Promise<Agent[]>;
  /**
   * Get agent by ID
   */
  getAgentAsync(id: string): Promise<Agent | undefined>;

  /**
   * Get agent by ID (throws if not found)
   */
  getAgentOrThrowAsync(id: string): Promise<Agent>;

  /**
   * Resolve an agent by identity — id, name, or role only.
   * Uses rankAgentsByIdentity() which never scores against markdown content,
   * tools, features, or specializations, preventing false positives where
   * another agent's document body mentions the queried name.
   *
   * Use searchAgents() when you need full fuzzy search across document content.
   *
   * @param query - Search string (id, full name, first name, or role)
   * @returns Matching agents sorted by relevance
   */
  resolveAgentAsync(query: string): Promise<Agent[]>;

  /**
   * Resolve an agent by fuzzy query (throws if not found)
   * @param query - Search string
   * @returns Single matched agent
   * @throws {AgentNotFoundError} If no match or ambiguous match
   */
  resolveAgentOrThrowAsync(query: string): Promise<Agent>;

  /**
   * Resolve an agent query for a user-facing operation.
   * Throws a helpful not-found error with suggestions or an ambiguous-query error.
   */
  resolveAgentForOperationAsync(
    query: string,
    operation: string
  ): Promise<{ id: string; name: string; role: string }>;

  /**
   * Resolve an agent query, returning null when no single match exists.
   */
  resolveAgentSafeAsync(query: string): Promise<{ id: string; name: string; role: string } | null>;

  /**
   * Analyze workspace permission overlap (files or patterns), optionally focused on one agent.
   */
  analyzeWorkspacePermissionOverlap(
    options?: AnalyzePermissionOverlapOptions
  ): Promise<PermissionOverlapReport>;

  /**
   * Create a new agent
   * @param config - Agent configuration (frontmatter fields)
   * @param options - Optional: markdown body and/or custom file path
   * @returns Created agent
   * @throws {ValidationError} If an agent with the same role already exists
   */
  createAgentAsync(
    config: AgentConfig,
    options?: { markdown?: string; targetPath?: string } | string
  ): Promise<Agent>;

  /**
   * Update an existing agent
   * @param id - Agent ID
   * @param updates - Partial agent config and/or markdown body to update
   * @returns Updated agent
   */
  updateAgentAsync(
    id: string,
    updates: Partial<AgentConfig> & { markdown?: string }
  ): Promise<Agent>;

  /**
   * Archive an agent (soft delete)
   * @param id - Agent ID
   */
  archiveAgentAsync(id: string): Promise<void>;

  /**
   * Get agents by role type
   * @param role - Role name
   */
  getAgentsByRoleAsync(role: string): Promise<Agent[]>;

  getDirectReportsAsync(managerId: string): Promise<Agent[]>;

  getAgentsByFeatureAsync(featureId: string): Promise<Agent[]>;

  searchAgentsAsync(options: AgentSearchOptions): Promise<AgentSearchResult[]>;

  /**
   * Update agent status
   * @param id - Agent ID
   * @param status - New status
   */
  updateStatusAsync(id: string, status: AgentStatus): Promise<void>;

  /**
   * Record agent interaction
   * @param id - Agent ID
   */
  recordInteractionAsync(id: string): Promise<void>;
}
