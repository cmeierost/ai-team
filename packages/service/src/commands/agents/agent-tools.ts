import type { IConfigurationStorage, IAgentManager, IAgentDocumentStorage } from '@ai-team/core';

export interface AgentManagementToolDependencies {
  configurationStorage: IConfigurationStorage;
  agentManager: IAgentManager;
  agentDocumentStorage: IAgentDocumentStorage;
}
