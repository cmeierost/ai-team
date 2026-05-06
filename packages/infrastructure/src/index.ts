/**
 * @ai-team/infrastructure - Runtime implementation exports
 *
 * This is the main entry point for infrastructure implementations.
 * Shared types and pure logic are sourced from @ai-team/core.
 */

// Re-export shared domain types/pure logic from core
export * from '@ai-team/core';

// Re-export fs-level types/functions that downstream packages import from core
export {
  getCachedFileTree,
  listCachedWorkspaceFiles,
  ContextRuntime,
  type FileTreeNode,
  type GetFileTreeOptions,
} from 'fs-context';

// Core modules
export * from './agent/index.js';
export * from './skill/index.js';
export * from './agent/team-graph-builder.js';
export * from './context/index.js';
export * from './context/path-permission-checker.js';
export * from './context/perm-overlap.js';
export { PermFileRegistry } from 'fs-context';
export * from './chat/index.js';
export * from './command-catalog/index.js';
export { withAbortSignal, isAbortError, throwIfAborted } from './utils/async.js';
export * from './agent/storage.js';
export * from './llm/index.js';
export {
  GitHubModelDiscoveryService,
  OpenAICompatibleModelDiscoveryService,
  ModelDiscoveryRegistry,
  createModelDiscoveryRegistry,
} from './llm/model-discovery.js';
export { LlmProviderTester } from './llm/provider-tester.js';
export * from './code-analysis/index.js';
export * from './code-edit/index.js';
export * from './ide/index.js';
export * from './storage/index.js';
export { MessagesRepository } from './repositories/messages-repository.js';
export { SessionsRepository } from './repositories/sessions-repository.js';
export { NotesRepository } from './repositories/notes-repository.js';
export { PlanningRepository } from './repositories/planning-repository.js';

// Avatar module
export {
  AvatarManager,
  avatarManager,
  generateAgentColor,
  parseHslHue,
  substituteUrlPlaceholders,
  downloadRandomAvatar,
  generateAvatarWithAI,
  buildAvatarPrompt,
  saveAvatarPreview,
  finalizeAvatar,
  cleanupPreview,
  updateAgentAvatar,
} from './agent/avatar.js';

// Watcher module (to be implemented)
// export * from './watcher/index.js';
