/**
 * Agent manager - handles loading, creating, and managing agents
 */

import path from 'path';
import {
  Agent,
  AgentNotFoundError,
  AgentConfig,
  AgentStatus,
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
   * Create a new agent
   * @param config - Agent configuration
   * @param targetPath - Optional custom path (defaults to .ai-team/agents/{name}.md)
   * @returns Created agent
   */
  async createAgent(config: AgentConfig, targetPath?: string): Promise<Agent> {
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
