/**
 * Agent manager - handles loading, creating, and managing agents
 */

import path from 'path';
import {
  Agent,
  AgentNotFoundError,
  AgentConfig,
  AgentStatus,
  AgentSearchOptions,
  AgentSearchResult,
  ValidationError,
} from '../types/index.js';
import {
  loadAgent,
  saveAgent,
  findAgentFiles,
  ensureAiTeamDirectory,
} from '../storage/index.js';
import { rankAgents, filterAndRankAgents } from './agent-search.js';

export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  public readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Initialize agent manager by loading all agents from workspace
   */
  async initialize(): Promise<void> {
    await ensureAiTeamDirectory(this.workspaceRoot);
    await this.loadAllAgents();
  }

  /**
   * Load all agents from workspace
   */
  async loadAllAgents(): Promise<void> {
    const agentFiles = await findAgentFiles(this.workspaceRoot);
    
    this.agents.clear();
    
    for (const filePath of agentFiles) {
      try {
        const agent = await loadAgent(filePath);
        this.agents.set(agent.id, agent);
      } catch (error) {
        console.error(`Failed to load agent from ${filePath}:`, error);
      }
    }
  }

  /**
   * Get all loaded agents
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by ID
   * @param id - Agent ID
   * @returns Agent or undefined
   */
  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /**
   * Get agent by ID (throws if not found)
   * @param id - Agent ID
   * @returns Agent
   * @throws {AgentNotFoundError} If agent doesn't exist
   */
  getAgentOrThrow(id: string): Agent {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }
    return agent;
  }

  /**
   * Resolve an agent by fuzzy query (id, role, or name).
   * Delegates to the shared rankAgents() primitive in agent-search.ts.
   *
   * @param query - Search string
   * @param minScore - Minimum relevance score to include (default 60). This
   *   excludes markdown-content (35-40), tool (45-50), and feature (55) boosters
   *   which cause false positives when the queried name appears only in another
   *   agent's document body (e.g. an org chart listing their manager). Pass 0
   *   to get every agent with any non-zero score, as for broad search UIs.
   * @returns Matching agents sorted by relevance
   */
  resolveAgent(query: string, minScore = 60): Agent[] {
    return rankAgents(query, this.getAllAgents())
      .filter(r => r.score >= minScore)
      .map(r => r.agent);
  }

  /**
   * Resolve an agent by fuzzy query (throws if not found)
   * @param query - Search string
   * @returns Single matched agent
   * @throws {AgentNotFoundError} If no match or ambiguous match
   */
  resolveAgentOrThrow(query: string): Agent {
    const matches = this.resolveAgent(query);
    if (matches.length === 0) {
      // Build "did you mean" suggestions
      const all = this.getAllAgents();
      const suggestions = all
        .map(a => `  - ${a.name} (${a.role}) [id: ${a.id}]`)
        .join('\n');
      const msg = suggestions
        ? `Agent not found: "${query}". Available agents:\n${suggestions}`
        : `Agent not found: "${query}". No agents in workspace.`;
      throw new AgentNotFoundError(msg);
    }
    if (matches.length === 1) return matches[0];
    // Multiple matches — return first but callers can handle the array
    return matches[0];
  }

  /**
   * Create a new agent
   * @param config - Agent configuration (frontmatter fields)
   * @param options - Optional: markdown body and/or custom file path
   * @returns Created agent
   * @throws {ValidationError} If an agent with the same role already exists
   */
  async createAgent(
    config: AgentConfig,
    options?: { markdown?: string; targetPath?: string } | string,
  ): Promise<Agent> {
    // Support legacy positional `targetPath` string for backward compat
    const opts = typeof options === 'string'
      ? { targetPath: options }
      : (options ?? {});

    // Enforce unique role names
    const existingWithRole = this.getAllAgents().find(
      a => a.role.toLowerCase() === config.role.toLowerCase()
    );
    if (existingWithRole) {
      throw new ValidationError(
        `An agent with role "${config.role}" already exists: ${existingWithRole.name} (${existingWithRole.id})`
      );
    }

    const id = config.name.toLowerCase().replace(/\s+/g, '-');
    const filePath = opts.targetPath || path.join(
      this.workspaceRoot,
      '.ai-team',
      'agents',
      `${id}.md`
    );

    const agent: Agent = {
      id,
      filePath,
      skillPath: path.join(this.workspaceRoot, '.ai-team', 'roles', `${config.role}.md`),
      createdAt: new Date().toISOString(),
      status: AgentStatus.AVAILABLE,
      ...config,
      ...(opts.markdown !== undefined ? { markdown: opts.markdown } : {}),
    };

    await saveAgent(agent);
    this.agents.set(id, agent);

    return agent;
  }

  /**
   * Update an existing agent
   * @param id - Agent ID
   * @param updates - Partial agent config and/or markdown body to update
   * @returns Updated agent
   */
  async updateAgent(id: string, updates: Partial<AgentConfig> & { markdown?: string }): Promise<Agent> {
    const agent = this.getAgentOrThrow(id);
    
    const updatedAgent: Agent = {
      ...agent,
      ...updates,
      lastInteraction: new Date().toISOString(),
    };

    await saveAgent(updatedAgent);
    this.agents.set(id, updatedAgent);

    return updatedAgent;
  }

  /**
   * Archive an agent (soft delete)
   * @param id - Agent ID
   */
  async archiveAgent(id: string): Promise<void> {
    const agent = this.getAgentOrThrow(id);
    
    // Move to archived subdirectory
    const archivedPath = agent.filePath.replace('/agents/', '/agents/archived/');
    const fs = await import('fs/promises');
    await fs.mkdir(path.dirname(archivedPath), { recursive: true });
    await fs.rename(agent.filePath, archivedPath);
    
    this.agents.delete(id);
  }

  /**
   * Get agents by role type
   * @param role - Role name
   */
  getAgentsByRole(role: string): Agent[] {
    return this.getAllAgents().filter(agent => agent.role === role);
  }

  /**
   * Get agents reporting to a specific agent
   * @param managerId - Manager agent ID
   */
  getDirectReports(managerId: string): Agent[] {
    return this.getAllAgents().filter(agent => agent.reportsTo === managerId);
  }

  /**
   * Get agents by feature
   * @param featureId - Feature ID
   */
  getAgentsByFeature(featureId: string): Agent[] {
    return this.getAllAgents().filter(agent => 
      agent.features?.includes(featureId)
    );
  }

  /**
   * Comprehensive agent search with fuzzy matching and filtering.
   * Delegates to the shared filterAndRankAgents() primitive in agent-search.ts.
   *
   * @param options - Search options
   * @returns Search results with relevance scores
   */
  searchAgents(options: AgentSearchOptions): AgentSearchResult[] {
    return filterAndRankAgents(options, this.getAllAgents());
  }

  /**
   * Update agent status
   * @param id - Agent ID
   * @param status - New status
   */
  async updateStatus(id: string, status: AgentStatus): Promise<void> {
    const agent = this.getAgentOrThrow(id);
    agent.status = status;
    this.agents.set(id, agent);
  }

  /**
   * Record agent interaction
   * @param id - Agent ID
   */
  async recordInteraction(id: string): Promise<void> {
    const agent = this.getAgentOrThrow(id);
    
    const updatedAgent: Agent = {
      ...agent,
      conversationCount: (agent.conversationCount || 0) + 1,
      lastInteraction: new Date().toISOString(),
    };

    await saveAgent(updatedAgent);
    this.agents.set(id, updatedAgent);
  }
}

