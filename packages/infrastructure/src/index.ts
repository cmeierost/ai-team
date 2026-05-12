/**
 * @ai-team/infrastructure - runtime implementation entry point.
 *
 * Keep this surface intentionally narrow: export only concrete adapters/services
 * required by other packages. Domain types remain in @ai-team/core.
 */

export { ContextRuntime, PermFileRegistry } from 'fs-context';

// Agent and workspace infrastructure
export {
  registerAgentInfrastructureServices,
  type AgentInfrastructureRegistrationTokens,
} from './agent/register-agent-infrastructure-services.js';
export {
  registerInfrastructureCoreServices,
  type InfrastructureCoreRegistrationTokens,
} from './registration/register-infrastructure-core-services.js';
export { ConfigurationStorage } from './agent/configuration-storage.js';
export { EnvironmentStorage } from './agent/environment-storage.js';
export { TeamGraphBuilder } from './agent/team-graph-builder.js';
export { AvatarManager, generateAgentColor, parseHslHue } from './agent/avatar.js';

// Chat and command metadata catalog
export { ChatManager, ChatStorage } from './chat/index.js';
export { registerCliCommandCatalog } from './command-catalog/index.js';

// Filesystem/context adapters
export {
  FileAnnotationServiceImpl,
  FileTreeServiceImpl,
  InfrastructureWorkspaceAccessRuntime,
  InfrastructureWorkspaceFsFactory,
} from './context/index.js';
export { PathPermissionChecker } from './context/path-permission-checker.js';

// LLM/tooling adapters
export { LlmService } from './llm/index.js';
export { createModelDiscoveryRegistry } from './llm/model-discovery.js';
export { LlmProviderTester } from './llm/provider-tester.js';
export { InfrastructureTextToolCallParser } from './llm/text-tool-call-parser.js';

// Code editing / IDE adapters
export { CodeEditManager } from './code-edit/index.js';
export { TypeScriptAnalyzer } from './code-analysis/typescript-analyzer.js';
export { createIdeAdapter, InfrastructureIdeAdapterFactory } from './ide/index.js';

// Storage and repositories
export { SqliteBackend } from './storage/sqlite/sqlite-storage.js';
export { InfrastructureProposalStoreFactory } from './storage/proposal-store.js';
export { MessagesRepository } from './repositories/messages-repository.js';
export { SessionsRepository } from './repositories/sessions-repository.js';
export { NotesRepository } from './repositories/notes-repository.js';
export { PlanningRepository } from './repositories/planning-repository.js';

// Platform and misc services
export { DeveloperIdentityService } from './platform/developer-identity-service.js';
export { SystemInfoService } from './platform/system-info-service.js';
export { NoteAttachmentReader } from './notes/note-attachment-reader.js';
