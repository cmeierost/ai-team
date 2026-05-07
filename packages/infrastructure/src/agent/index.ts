export { AgentManager } from './agent-manager.js';
export {
  AgentDocumentStorage,
  ConfigurationStorage,
  EnvironmentStorage,
  MarkdownSectionService,
  WorkspaceDiscoveryStorage,
  WorkspaceStorage,
} from './storage.js';

import { PermFileRegistry } from 'fs-context';
import { AgentManager } from './agent-manager.js';
import {
  AgentDocumentStorage,
  MarkdownSectionService,
  WorkspaceDiscoveryStorage,
  WorkspaceStorage,
} from './storage.js';

/**
 * Backward-compatible factory used by tests and legacy call sites.
 *
 * Creates an AgentManager with the standard infrastructure adapters wired in.
 */
export function createAgentManager(workspaceRoot: string): AgentManager {
  return new AgentManager(
    workspaceRoot,
    new AgentDocumentStorage(
      new MarkdownSectionService(),
      new WorkspaceStorage(),
      new WorkspaceDiscoveryStorage()
    ),
    new WorkspaceStorage(),
    new WorkspaceDiscoveryStorage(),
    new PermFileRegistry(workspaceRoot)
  );
}
