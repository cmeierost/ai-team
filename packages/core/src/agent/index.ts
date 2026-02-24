/**
 * Agent manager - handles loading, creating, and managing agents
 */

import path from 'path';
import {
  Agent,
  AgentNotFoundError,
  AgentConfig,
  AgentStatus,
  ValidationError,
} from '../types/index.js';
import {
  loadAgent,
  saveAgent,
  findAgentFiles,
  ensureAiTeamDirectory,
} from '../storage/index.js';

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
   * Matching priority:
   *   1. Exact ID
   *   2. Exact role
   *   3. Exact name (case-insensitive)
   *   4. Partial ID / role substring
   *   5. Partial name substring
   *   6. Fuzzy name match (Levenshtein distance ≤ 2)
   *   7. Fuzzy first-name match (Levenshtein distance ≤ 2)
   *
   * @param query - Search string
   * @returns Matching agents sorted by relevance
   */
  resolveAgent(query: string): Agent[] {
    const q = query.toLowerCase().trim();
    const all = this.getAllAgents();

    // 1. Exact ID match
    const exactId = this.agents.get(q);
    if (exactId) return [exactId];

    // 2. Exact role match
    const exactRole = all.filter(a => a.role.toLowerCase() === q);
    if (exactRole.length > 0) return exactRole;

    // 3. Exact name match (case-insensitive)
    const exactName = all.filter(a => a.name.toLowerCase() === q);
    if (exactName.length > 0) return exactName;

    // 4. Partial ID or role match
    const partialIdRole = all.filter(
      a => a.id.includes(q) || a.role.toLowerCase().includes(q)
    );
    if (partialIdRole.length > 0) return partialIdRole;

    // 5. Partial name match (any word)
    const partialName = all.filter(a =>
      a.name.toLowerCase().includes(q)
    );
    if (partialName.length > 0) return partialName;

    // 6. Fuzzy full-name match (Levenshtein distance ≤ 2)
    const fuzzyFull = all.filter(a =>
      levenshtein(a.name.toLowerCase(), q) <= 2
    );
    if (fuzzyFull.length > 0) return fuzzyFull;

    // 7. Fuzzy first-name match (handles "dimitry" → "dimitri")
    const fuzzyFirst = all.filter(a => {
      const firstName = a.name.toLowerCase().split(/\s+/)[0];
      return levenshtein(firstName, q) <= 2;
    });
    if (fuzzyFirst.length > 0) return fuzzyFirst;

    return [];
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
   * @param config - Agent configuration
   * @param targetPath - Optional custom path (defaults to .ai-team/agents/{name}.md)
   * @returns Created agent
   * @throws {ValidationError} If an agent with the same role already exists
   */
  async createAgent(config: AgentConfig, targetPath?: string): Promise<Agent> {
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
    const filePath = targetPath || path.join(
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
    };

    await saveAgent(agent);
    this.agents.set(id, agent);

    return agent;
  }

  /**
   * Update an existing agent
   * @param id - Agent ID
   * @param updates - Partial agent config to update
   * @returns Updated agent
   */
  async updateAgent(id: string, updates: Partial<AgentConfig>): Promise<Agent> {
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

// ============================================================================
// Levenshtein distance — for fuzzy name matching
// ============================================================================

/**
 * Compute Levenshtein edit distance between two strings.
 * Used to tolerate typos: "dimitry" → "dimitri" (distance 1).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return dp[m][n];
}
