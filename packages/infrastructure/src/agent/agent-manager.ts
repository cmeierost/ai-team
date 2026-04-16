import path from 'node:path';
import {
  IAgentManager,
  Agent,
  AgentConfig,
  ValidationError,
  AgentNotFoundError,
  AgentStatus,
  AgentSearchOptions,
  AgentSearchResult,
  RankedAgentResult,
} from '@ai-team/core';
import { rankAgentsByIdentity, filterAndRankAgents } from './agent-search.js';
import {
  ensureAiTeamDirectory,
  saveAgent,
  findAgentFiles,
  loadAgent,
  loadAgentAccessPatterns,
} from './storage.js';
import { levenshtein } from '../utils/str.js';

export class AgentManager implements IAgentManager {
  private agents: Map<string, Agent> = new Map();
  private agentsLoaded = false;
  private readonly idIndex: Map<string, Agent> = new Map();
  private readonly roleIndex: Map<string, Set<string>> = new Map();
  private readonly nameIndex: Map<string, Set<string>> = new Map();
  private readonly tokenIndex: Map<string, Set<string>> = new Map();
  public readonly workspaceRoot: string;

  // -------------------------------------------------------------------------
  // Auto-handoff generation — keeps Copilot handoffs in sync with hierarchy
  // -------------------------------------------------------------------------
  private static readonly AUTO_HANDOFF_TAG = '[auto]';

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get the agents map, loading from disk on first call.
   */
  async getAgentsAsync(): Promise<Map<string, Agent>> {
    if (!this.agentsLoaded) {
      this.agentsLoaded = true;
      await ensureAiTeamDirectory(this.workspaceRoot);
      this.agents = await this.loadAllAgentsAsync();
    }
    return this.agents;
  }

  /**
   * Force a full refresh from disk.
   */
  async refreshAsync(): Promise<void> {
    this.agentsLoaded = false;
    this.agents = new Map();
    this.clearIndexes();
    await this.getAgentsAsync();
  }

  async rankAgents(query: string | undefined): Promise<RankedAgentResult[]> {
    const agents = await this.getAgentsAsync();
    if (!query || query.trim() === '') {
      return Array.from(agents.values()).map((agent) => ({ agent, score: 50, matches: [] }));
    }

    const q = query.toLowerCase().trim();
    const results: RankedAgentResult[] = [];

    for (const agent of agents.values()) {
      let score = 0;
      const matches: string[] = [];

      // ── Base tier ────────────────────────────────────────────────────────────
      if (agent.id === q) {
        score = 100;
        matches.push('id');
      } else if (agent.name.toLowerCase() === q) {
        score = 95;
        matches.push('name');
      } else if (agent.role.toLowerCase() === q) {
        score = 90;
        matches.push('role');
      } else if (agent.name.toLowerCase().includes(q)) {
        score = 85;
        matches.push('name');
      } else if (agent.id.includes(q)) {
        score = 80;
        matches.push('id');
      } else if (agent.role.toLowerCase().includes(q)) {
        score = 75;
        matches.push('role');
      } else if (levenshtein(agent.name.toLowerCase(), q) <= 2) {
        score = 70 + (2 - levenshtein(agent.name.toLowerCase(), q)) * 2.5;
        matches.push('name');
      } else {
        const firstName = agent.name.toLowerCase().split(/\s+/)[0];
        if (levenshtein(firstName, q) <= 2) {
          score = 65 + (2 - levenshtein(firstName, q)) * 2.5;
          matches.push('name');
        }
      }

      // ── Boosters ─────────────────────────────────────────────────────────────
      if (agent.specializations) {
        for (const spec of agent.specializations) {
          const s = spec.toLowerCase();
          if (s === q) {
            score = Math.max(score, 70);
            if (!matches.includes('specializations')) matches.push('specializations');
          } else if (s.includes(q)) {
            score = Math.max(score, 60);
            if (!matches.includes('specializations')) matches.push('specializations');
          } else if (q.length > 3 && levenshtein(s, q) <= 2) {
            score = Math.max(score, 55);
            if (!matches.includes('specializations')) matches.push('specializations');
          }
        }
      }

      if (agent.features) {
        for (const feature of agent.features) {
          const f = feature.toLowerCase();
          if (f.includes(q) || q.includes(f)) {
            score = Math.max(score, 55);
            if (!matches.includes('features')) matches.push('features');
          }
        }
      }

      const agentTools = [...(agent.tools ?? []), ...(agent.cliTools ?? [])];
      for (const tool of agentTools) {
        const t = tool.toLowerCase();
        if (t === q) {
          score = Math.max(score, 50);
          if (!matches.includes('tools')) matches.push('tools');
        } else if (t.includes(q)) {
          score = Math.max(score, 45);
          if (!matches.includes('tools')) matches.push('tools');
        }
      }

      if (agent.markdown) {
        const c = agent.markdown.toLowerCase();
        if (c.includes(q)) {
          score = Math.max(score, q.length > 5 ? 40 : 35);
          if (!matches.includes('markdown')) matches.push('markdown');
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      if (score > 0) {
        results.push({ agent, score, matches });
      }
    }

    // Highest score first
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Ensure an agent's `handoffs` array contains auto-generated entries for:
   *   1. Upward — a handoff **to** the agent's boss (via `reportsTo`)
   *   2. Downward — a handoff **to** each direct report
   *
   * Handoffs that were created manually (no `[auto]` tag in the label) are
   * never touched, even if they point to the same target agent.
   */
  private syncHandoffs(agent: Agent): void {
    const tag = AgentManager.AUTO_HANDOFF_TAG;

    // Start from the current handoffs, dropping stale auto-generated ones
    const manualHandoffs = (agent.handoffs ?? []).filter((h) => !h.label.startsWith(tag));

    const autoHandoffs: typeof manualHandoffs = [];

    // 1. Upward handoff → boss
    if (agent.reportsTo) {
      const boss = this.agents!.get(agent.reportsTo);
      const bossLabel = boss?.name ?? agent.reportsTo;
      autoHandoffs.push({
        label: `${tag} Report to ${bossLabel}`,
        agent: agent.reportsTo,
        prompt: `Reporting back with my findings and progress.`,
      });
    }

    // 2. Downward handoffs → direct reports
    for (const [, other] of this.agents!) {
      if (other.reportsTo === agent.id) {
        autoHandoffs.push({
          label: `${tag} Delegate to ${other.name}`,
          agent: other.id,
          prompt: `Please take this on within your area of responsibility.`,
        });
      }
    }

    agent.handoffs = [...manualHandoffs, ...autoHandoffs];
  }

  /**
   * Resync handoffs for a boss agent after a subordinate's reportsTo changed.
   * Skips silently if bossId is undefined or unknown.
   */
  private async resyncBossHandoffs(bossId: string | undefined): Promise<void> {
    if (!bossId) return;
    const boss = this.agents!.get(bossId);
    if (!boss) return;
    this.syncHandoffs(boss);
    await saveAgent(boss);
  }

  private toAgentId(config: AgentConfig): string {
    const raw = config.id ?? config.aiTeamId ?? config.name ?? config.aiTeamName;
    const normalized = raw
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!normalized) {
      throw new ValidationError(
        'Agent identity is invalid. Provide id/name or a compatible legacy aiTeamId/aiTeamName.'
      );
    }
    return normalized;
  }

  private toAgentName(config: AgentConfig, id: string): string {
    const explicit = config.name ?? config.aiTeamName;
    const cleaned = explicit?.trim();
    if (cleaned) return cleaned;

    return id
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  /**
   * Load all agents from workspace
   */
  private async loadAllAgentsAsync(): Promise<Map<string, Agent>> {
    const agentFiles = await findAgentFiles(this.workspaceRoot);
    const agents = new Map<string, Agent>();

    this.clearIndexes();

    for (const filePath of agentFiles) {
      try {
        const agent = await loadAgent(filePath);

        // Merge fallback permissions from the .perm file alongside any YAML-specified permissions
        const accessPatterns = await loadAgentAccessPatterns(this.workspaceRoot, agent.id);
        agent.permissions = {
          list: [...new Set([...(agent.permissions?.list ?? []), ...accessPatterns.list])],
          read: [...new Set([...(agent.permissions?.read ?? []), ...accessPatterns.read])],
          write: [...new Set([...(agent.permissions?.write ?? []), ...accessPatterns.write])],
        };

        if (agents.has(agent.id)) {
          console.error(
            `Duplicate agent id "${agent.id}" detected at ${filePath}. Skipping duplicate.`
          );
          continue;
        }
        agents.set(agent.id, agent);
        this.indexAgent(agent);
      } catch (error) {
        console.error(`Failed to load agent from ${filePath}:`, error);
      }
    }

    // After all agents are loaded, sync auto-generated handoffs for every agent
    this.agents = agents;
    for (const [, agent] of agents) {
      this.syncHandoffs(agent);
    }
    return agents;
  }

  /**
   * Get all loaded agents
   */
  async getAllAgentsAsync(): Promise<Agent[]> {
    return Array.from((await this.getAgentsAsync()).values());
  }

  /**
   * Get agent by ID
   */
  async getAgentAsync(id: string): Promise<Agent | undefined> {
    return (await this.getAgentsAsync()).get(id);
  }

  /**
   * Get agent by ID (throws if not found)
   */
  async getAgentOrThrowAsync(id: string): Promise<Agent> {
    const agent = (await this.getAgentsAsync()).get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }
    return agent;
  }

  /**
   * Synchronous ID lookup on the already-loaded agents map.
   * Only works reliably after getAgentsAsync() has been called at least once.
   * Used by parsers and other sync contexts that need a fast in-memory lookup.
   */
  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /**
   * Synchronous name/role/id resolution on the already-loaded agents map.
   * Only works reliably after getAgentsAsync() has been called at least once.
   * Used by parsers and other sync contexts.
   */
  resolveAgent(query: string): Agent[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...this.agents.values()].filter(
      (a) =>
        a.id.toLowerCase() === q ||
        a.name.toLowerCase() === q ||
        a.name
          .toLowerCase()
          .split(/\s+/)
          .some((part) => part.startsWith(q)) ||
        a.role.toLowerCase() === q
    );
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
  async resolveAgentAsync(query: string): Promise<Agent[]> {
    await this.getAgentsAsync();
    const queryNorm = query.trim().toLowerCase();
    if (!queryNorm) return [];

    const candidates = await this.getCandidates(queryNorm);

    return rankAgentsByIdentity(query, candidates).map((r) => r.agent);
  }

  /**
   * Resolve an agent by fuzzy query (throws if not found)
   * @param query - Search string
   * @returns Single matched agent
   * @throws {AgentNotFoundError} If no match or ambiguous match
   */
  async resolveAgentOrThrowAsync(query: string): Promise<Agent> {
    const matches = await this.resolveAgentAsync(query);
    if (matches.length === 0) {
      const all = await this.getAllAgentsAsync();
      const suggestions = all.map((a) => `  - ${a.name} (${a.role}) [id: ${a.id}]`).join('\n');
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
  async createAgentAsync(
    config: AgentConfig,
    options?: { markdown?: string; targetPath?: string } | string
  ): Promise<Agent> {
    const agents = await this.getAgentsAsync();
    // Support legacy positional `targetPath` string for backward compat
    const opts = typeof options === 'string' ? { targetPath: options } : (options ?? {});

    // Enforce unique role names
    const existingWithRole = (await this.getAllAgentsAsync()).find(
      (a) => a.role.toLowerCase() === config.role.toLowerCase()
    );
    if (existingWithRole) {
      throw new ValidationError(
        `An agent with role "${config.role}" already exists: ${existingWithRole.name} (${existingWithRole.id})`
      );
    }

    const id = this.toAgentId(config);
    const name = this.toAgentName(config, id);
    const filePath =
      opts.targetPath || path.join(this.workspaceRoot, '.ai-team', 'agents', `${id}.agent.md`);

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

    this.syncHandoffs(agent);
    await saveAgent(agent);
    agents.set(id, agent);
    this.indexAgent(agent);

    return agent;
  }

  /**
   * Update an existing agent
   * @param id - Agent ID
   * @param updates - Partial agent config and/or markdown body to update
   * @returns Updated agent
   */
  async updateAgentAsync(
    id: string,
    updates: Partial<AgentConfig> & { markdown?: string }
  ): Promise<Agent> {
    await this.getAgentsAsync();
    const agent = await this.getAgentOrThrowAsync(id);

    const oldReportsTo = agent.reportsTo;

    // Deindex before mutation so old role/name entries are cleaned up
    this.deindexAgent(agent);

    // Mutate in place so callers holding a reference see the update immediately
    Object.assign(agent, updates, { lastInteraction: new Date().toISOString() });

    this.syncHandoffs(agent);
    await saveAgent(agent);
    this.indexAgent(agent);

    // If reportsTo changed, resync the old and new bosses so their
    // downward [auto] handoffs stay consistent.
    if (oldReportsTo !== agent.reportsTo) {
      await this.resyncBossHandoffs(oldReportsTo);
      await this.resyncBossHandoffs(agent.reportsTo);
    }

    return agent;
  }

  /**
   * Archive an agent (soft delete)
   * @param id - Agent ID
   */
  async archiveAgentAsync(id: string): Promise<void> {
    const agents = await this.getAgentsAsync();
    const agent = await this.getAgentOrThrowAsync(id);

    // Move to archived subdirectory relative to current file location
    const archivedPath = path.join(
      path.dirname(agent.filePath),
      'archived',
      path.basename(agent.filePath)
    );
    const fs = await import('fs/promises');
    await fs.mkdir(path.dirname(archivedPath), { recursive: true });
    await fs.rename(agent.filePath, archivedPath);

    // Clean up legacy .yml/.yaml sidecars instead of archiving them
    const metadataCandidates = agent.filePath.toLowerCase().endsWith('.agent.md')
      ? [agent.filePath.slice(0, -3) + 'yml', agent.filePath.slice(0, -3) + 'yaml']
      : [];
    for (const candidate of metadataCandidates) {
      try {
        await fs.unlink(candidate);
      } catch {
        // Ignore missing sidecars
      }
    }

    this.deindexAgent(agent);
    agents.delete(id);
  }

  /**
   * Get agents by role type
   * @param role - Role name
   */
  async getAgentsByRoleAsync(role: string): Promise<Agent[]> {
    return (await this.getAllAgentsAsync()).filter((agent) => agent.role === role);
  }

  async getDirectReportsAsync(managerId: string): Promise<Agent[]> {
    return (await this.getAllAgentsAsync()).filter((agent) => agent.reportsTo === managerId);
  }

  async getAgentsByFeatureAsync(featureId: string): Promise<Agent[]> {
    return (await this.getAllAgentsAsync()).filter((agent) => agent.features?.includes(featureId));
  }

  async searchAgentsAsync(options: AgentSearchOptions): Promise<AgentSearchResult[]> {
    return filterAndRankAgents(options, await this.getAllAgentsAsync());
  }

  /**
   * Update agent status
   * @param id - Agent ID
   * @param status - New status
   */
  async updateStatusAsync(id: string, status: AgentStatus): Promise<void> {
    const agents = await this.getAgentsAsync();
    const agent = await this.getAgentOrThrowAsync(id);
    agent.status = status;
    agents.set(id, agent);
  }

  /**
   * Record agent interaction
   * @param id - Agent ID
   */
  async recordInteractionAsync(id: string): Promise<void> {
    const agents = await this.getAgentsAsync();
    const agent = await this.getAgentOrThrowAsync(id);

    const updatedAgent: Agent = {
      ...agent,
      conversationCount: (agent.conversationCount || 0) + 1,
      lastInteraction: new Date().toISOString(),
    };

    await saveAgent(updatedAgent);
    this.deindexAgent(agent);
    agents.set(id, updatedAgent);
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
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private async getCandidates(normalizedQuery: string): Promise<Agent[]> {
    const exactId = this.idIndex.get(normalizedQuery);
    if (exactId) return [exactId];

    const candidateIds = new Set<string>();

    for (const id of this.roleIndex.get(normalizedQuery) ?? []) candidateIds.add(id);
    for (const id of this.nameIndex.get(normalizedQuery) ?? []) candidateIds.add(id);
    for (const id of this.tokenIndex.get(normalizedQuery) ?? []) candidateIds.add(id);

    if (candidateIds.size === 0) {
      return await this.getAllAgentsAsync();
    }

    return Array.from(candidateIds)
      .map((id) => this.agents!.get(id))
      .filter((agent): agent is Agent => Boolean(agent));
  }
}
