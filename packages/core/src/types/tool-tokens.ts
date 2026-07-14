/**
 * Minimal DI tokens for services that tools need via ToolContext.resolve.
 * These token IDs must match the IDs registered in @ai-team/container's TOKENS.
 * Defined here in core so tool implementations (packages/service) can access
 * them without creating a circular dependency (container → service → container).
 */
import { Token } from './runtime-contracts.js';
import type { IAgentManager } from './agent-models.js';
import type { IAgentDocumentStorage, IConfigurationStorage } from './communication.js';
import type { IAvatarManager } from '../agent/avatar.js';
import type { IFileAnnotationService, IFileTreeService } from '../context/index.js';

export const TOOL_SERVICE_TOKENS = {
  AgentManager: new Token<IAgentManager>('AgentManager'),
  AgentDocumentStorage: new Token<IAgentDocumentStorage>('AgentDocumentStorage'),
  ConfigurationStorage: new Token<IConfigurationStorage>('ConfigurationStorage'),
  AvatarManager: new Token<IAvatarManager>('AvatarManager'),
  FileTreeService: new Token<IFileTreeService>('FileTreeService'),
  FileAnnotationService: new Token<IFileAnnotationService>('FileAnnotationService'),
} as const;
