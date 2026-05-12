import type {
  IAgentDocumentStorage,
  IAgentManager,
  IContainerToken,
  IMarkdownSectionService,
  IPermissionStorage,
  IServiceContainerRegistrar,
  ISkillManager,
  IWorkspaceStorage,
} from '@ai-team/core';
import { AgentDocumentStorage } from './agent-document-storage.js';
import { AgentManager } from './agent-manager.js';
import { MarkdownSectionService } from './markdown-service.js';
import { WorkspaceDiscoveryStorage } from './workspace-discovery-storage.js';
import { WorkspaceStorage } from './workspace-storage.js';
import { SkillManager } from '../skill/index.js';

/**
 * Minimal token bag needed to register the agent module into an external DI container.
 *
 * This keeps infrastructure internals hidden while allowing callers to wire the module
 * through interfaces/tokens only.
 */
export interface AgentInfrastructureRegistrationTokens {
  WorkspaceRoot: IContainerToken<string>;
  PermissionStorage: IContainerToken<IPermissionStorage>;
  MarkdownSectionService: IContainerToken<IMarkdownSectionService>;
  WorkspaceStorage: IContainerToken<IWorkspaceStorage>;
  AgentDocumentStorage: IContainerToken<IAgentDocumentStorage>;
  AgentManager: IContainerToken<IAgentManager>;
  SkillManager: IContainerToken<ISkillManager>;
}

/**
 * Register all agent-domain infrastructure services as container singletons.
 */
export function registerAgentInfrastructureServices(
  container: IServiceContainerRegistrar,
  tokens: AgentInfrastructureRegistrationTokens
): void {
  container.registerSingleton(tokens.MarkdownSectionService, () => new MarkdownSectionService());
  container.registerSingleton(tokens.WorkspaceStorage, () => new WorkspaceStorage());

  container.registerSingleton(tokens.AgentDocumentStorage, (c) => {
    const workspaceStorage = c.resolve(tokens.WorkspaceStorage);
    const workspaceDiscoveryStorage = new WorkspaceDiscoveryStorage();
    return new AgentDocumentStorage(
      c.resolve(tokens.MarkdownSectionService),
      workspaceStorage,
      workspaceDiscoveryStorage
    );
  });

  container.registerSingleton(tokens.AgentManager, (c) => {
    const agentDocumentStorage = c.resolve(tokens.AgentDocumentStorage);
    const workspaceStorage = c.resolve(tokens.WorkspaceStorage);
    const workspaceDiscoveryStorage = new WorkspaceDiscoveryStorage();

    return new AgentManager(
      c.resolve(tokens.WorkspaceRoot),
      agentDocumentStorage,
      workspaceStorage,
      workspaceDiscoveryStorage,
      c.resolve(tokens.PermissionStorage)
    );
  });

  container.registerSingleton(tokens.SkillManager, (c) => {
    const agentDocumentStorage = c.resolve(tokens.AgentDocumentStorage);
    const workspaceDiscoveryStorage = new WorkspaceDiscoveryStorage();
    return new SkillManager(
      c.resolve(tokens.WorkspaceRoot),
      agentDocumentStorage,
      workspaceDiscoveryStorage
    );
  });
}
