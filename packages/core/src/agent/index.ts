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
import { rankAgentsByIdentity, filterAndRankAgents } from './agent-search.js';

export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private idIndex: Map<string, Agent> = new Map();
  private roleIndex: Map<string, Set<string>> = new Map();
  private nameIndex: Map<string, Set<string>> = new Map();
  private tokenIndex: Map<string, Set<string>> = new Map();
  public readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  private toAgentId(config: AgentConfig): string {
    const raw = config.aiTeamId ?? config.id ?? config.aiTeamName ?? config.name;
    const normalized = raw
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!normalized) {
      throw new ValidationError('Agent identity is invalid. Provide aiTeamId/id or a valid aiTeamName/name.');
    }
    return normalized;
  }

  private toAgentName(config: AgentConfig, id: string): string {
    const explicit = config.aiTeamName ?? config.name;
    const cleaned = explicit?.trim();
    if (cleaned) return cleaned;

    return id
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
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
    this.clearIndexes();
    
    for (const filePath of agentFiles) {
      try {
        const agent = await loadAgent(filePath);
        if (this.agents.has(agent.id)) {
          console.error(`Duplicate agent id "${agent.id}" detected at ${filePath}. Skipping duplicate.`);
          continue;
        }
        this.agents.set(agent.id, agent);
        this.indexAgent(agent);
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
  resolveAgent(query: string): Agent[] {
    const queryNorm = query.trim().toLowerCase();
    if (!queryNorm) return [];

    const candidates = this.getCandidates(queryNorm);

    return rankAgentsByIdentity(query, candidates)
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

    const id = this.toAgentId(config);
    const name = this.toAgentName(config, id);
    const filePath = opts.targetPath || path.join(
      this.workspaceRoot,
      '.ai-team',
      'agents',
      id,
      'agent.md'
    );

    const agent: Agent = {
      id,
      name,
      filePath,
      skillPath: path.join(this.workspaceRoot, '.ai-team', 'roles', `${config.role}.md`),
      createdAt: new Date().toISOString(),
      status: AgentStatus.AVAILABLE,
      ...config,
      ...(opts.markdown !== undefined ? { markdown: opts.markdown } : {}),
    };

    await saveAgent(agent);
    this.agents.set(id, agent);
    this.indexAgent(agent);

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
    
    const oldAgent = this.getAgentOrThrow(id);

    const updatedAgent: Agent = {
      ...agent,
      ...updates,
      lastInteraction: new Date().toISOString(),
    };

    await saveAgent(updatedAgent);
    this.deindexAgent(oldAgent);
    this.agents.set(id, updatedAgent);
    this.indexAgent(updatedAgent);

    return updatedAgent;
  }

  /**
   * Archive an agent (soft delete)
   * @param id - Agent ID
   */
  async archiveAgent(id: string): Promise<void> {
    const agent = this.getAgentOrThrow(id);
    
    // Move to archived subdirectory relative to current file location
    const archivedPath = path.join(path.dirname(agent.filePath), 'archived', path.basename(agent.filePath));
    const fs = await import('fs/promises');
    await fs.mkdir(path.dirname(archivedPath), { recursive: true });
    await fs.rename(agent.filePath, archivedPath);
    
    this.deindexAgent(agent);
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
    this.deindexAgent(agent);
    this.agents.set(id, updatedAgent);
    this.indexAgent(updatedAgent);
  }

  private clearIndexes(): void {
    this.idIndex.clear();
    this.roleIndex.clear();
    this.nameIndex.clear();
    this.tokenIndex.clear();
  }

  private indexAgent(agent: Agent): void {
    this.idIndex.set(agent.id.toLowerCase(), agent);
    this.addIndexEntry(this.roleIndex, agent.role.toLowerCase(), agent.id);
    this.addIndexEntry(this.nameIndex, agent.name.toLowerCase(), agent.id);

    for (const token of this.tokenize(agent.name)) {
      this.addIndexEntry(this.tokenIndex, token, agent.id);
    }
  }

  private deindexAgent(agent: Agent): void {
    this.idIndex.delete(agent.id.toLowerCase());
    this.removeIndexEntry(this.roleIndex, agent.role.toLowerCase(), agent.id);
    this.removeIndexEntry(this.nameIndex, agent.name.toLowerCase(), agent.id);

    for (const token of this.tokenize(agent.name)) {
      this.removeIndexEntry(this.tokenIndex, token, agent.id);
    }
  }

  private addIndexEntry(index: Map<string, Set<string>>, key: string, id: string): void {
    const existing = index.get(key) ?? new Set<string>();
    existing.add(id);
    index.set(key, existing);
  }

  private removeIndexEntry(index: Map<string, Set<string>>, key: string, id: string): void {
    const existing = index.get(key);
    if (!existing) return;
    existing.delete(id);
    if (existing.size === 0) {
      index.delete(key);
      return;
    }
    index.set(key, existing);
  }

  private tokenize(value: string): string[] {
    return value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  private getCandidates(normalizedQuery: string): Agent[] {
    const exactId = this.idIndex.get(normalizedQuery);
    if (exactId) return [exactId];

    const candidateIds = new Set<string>();

    for (const id of this.roleIndex.get(normalizedQuery) ?? []) candidateIds.add(id);
    for (const id of this.nameIndex.get(normalizedQuery) ?? []) candidateIds.add(id);
    for (const id of this.tokenIndex.get(normalizedQuery) ?? []) candidateIds.add(id);

    if (candidateIds.size === 0) {
      return this.getAllAgents();
    }

    return Array.from(candidateIds)
      .map(id => this.agents.get(id))
      .filter((agent): agent is Agent => Boolean(agent));
  }
}

