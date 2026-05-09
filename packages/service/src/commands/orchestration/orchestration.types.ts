import type { Agent, AgentConfig, ToolCatalogEntry } from '@ai-team/core';
import type { WorkflowDefinitionApiResponse } from '@ai-team/api-contracts';

/**
 * Minimal session access needed by orchestration handoff command.
 */
export interface ISessionGateway {
  getLatestSession(agentId: string): Promise<{ id: string; agentId: string } | null>;
}

/**
 * Minimal agent registry access needed by orchestration commands.
 */
export interface IAgentRegistry {
  getAgentAsync(id: string): Promise<Agent | undefined>;
  getAllAgentsAsync(): Promise<Agent[]>;
  createAgentAsync(config: AgentConfig): Promise<Agent>;
}

/**
 * Minimal tool catalog access needed by orchestration commands.
 */
export interface IToolCatalog {
  whoCanExecute(toolName: string, args: unknown, agents: Agent[]): Promise<Agent[]>;
  catalog(agent: Agent): ToolCatalogEntry[];
}

/** Minimal workflow-definition catalog access needed by orchestration workflow tools. */
export interface IWorkflowCatalog {
  listWorkflowIds(): string[];
  getWorkflowDefinition(workflowId: string): Promise<WorkflowDefinitionApiResponse>;
}

/** Full dependency bag passed to createOrchestrationCommands(). */
export interface OrchestrationDeps {
  sessions: ISessionGateway;
  agents: IAgentRegistry;
  tools: IToolCatalog;
  workflows: IWorkflowCatalog;
}
