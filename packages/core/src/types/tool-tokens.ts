/**
 * Minimal DI tokens for services that tools need via ToolContext.resolve.
 * These token IDs must match the IDs registered in @ai-team/container's TOKENS.
 * Defined here in core so tool implementations (packages/service) can access
 * them without creating a circular dependency (container → service → container).
 */
import type { IContainerToken } from './runtime-contracts.js';
import type { IAgentManager } from './agent-models.js';
import type { IAgentDocumentStorage, IConfigurationStorage } from './communication.js';
import type { IAvatarManager } from '../agent/avatar.js';
import type { IFileAnnotationService, IFileTreeService } from '../context/index.js';

function makeToken<T>(id: string): IContainerToken<T> {
  return { id, toString: () => `Token(${id})` };
}

export const TOOL_SERVICE_TOKENS = {
  AgentManager: makeToken<IAgentManager>('AgentManager'),
  AgentDocumentStorage: makeToken<IAgentDocumentStorage>('AgentDocumentStorage'),
  ConfigurationStorage: makeToken<IConfigurationStorage>('ConfigurationStorage'),
  AvatarManager: makeToken<IAvatarManager>('AvatarManager'),
  FileTreeService: makeToken<IFileTreeService>('FileTreeService'),
  FileAnnotationService: makeToken<IFileAnnotationService>('FileAnnotationService'),
} as const;
