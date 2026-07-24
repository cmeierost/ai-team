import type {
  CoreServiceRegistrationTokens,
  ILlmService,
  IContainerToken,
  IServiceContainerRegistrar,
} from '@ai-team/core';
import { ContextRuntime } from 'fs-context';
import { SqliteBackend } from '../storage/sqlite/sqlite-storage.js';
import { NotesRepository } from '../repositories/notes-repository.js';
import { MessagesRepository } from '../repositories/messages-repository.js';
import { SessionsRepository } from '../repositories/sessions-repository.js';
import { PlanningRepository } from '../repositories/planning-repository.js';
import { LlmService } from '../llm/index.js';
import { ConfigurationStorage } from '../agent/configuration-storage.js';
import { PathPermissionChecker } from '../context/path-permission-checker.js';
import { DeveloperIdentityService } from '../platform/developer-identity-service.js';
import { SystemInfoService } from '../platform/system-info-service.js';
import { ModelDiscoveryRegistry } from '../llm/model-discovery.js';
import { LlmProviderTester } from '../llm/provider-tester.js';
import { PermFileRegistry } from 'fs-context';
import { registerAgentInfrastructureServices } from '../agent/register-agent-infrastructure-services.js';
import { AvatarManager } from '../agent/avatar.js';
import { CodeEditManager } from '../code-edit/index.js';
import { TypeScriptAnalyzer } from '../code-analysis/typescript-analyzer.js';
import {
  FileAnnotationServiceImpl,
  FileTreeServiceImpl,
  InfrastructureFuzzyFileSearch,
  InfrastructureWorkspaceAccessRuntime,
  InfrastructureWorkspaceFsFactory,
} from '../context/index.js';
import { InfrastructureIdeAdapterFactory } from '../ide/index.js';
import { NoteAttachmentReader } from '../notes/note-attachment-reader.js';
import { InfrastructureProposalStoreFactory } from '../storage/proposal-store.js';
import { InfrastructureTextToolCallParser } from '../llm/text-tool-call-parser.js';
import { ChatStorage, ChatManager } from '../chat/index.js';
import { TeamGraphBuilder } from '../agent/team-graph-builder.js';
import { ProviderConfigurationService } from '../llm/provider-configuration.service.js';
import { InfrastructureLlmSettingsResolver } from '../llm/llm-settings-resolver.js';
import {
  GitHubModelDiscoveryService,
  OpenAICompatibleModelDiscoveryService,
} from '../llm/model-discovery.js';

export function registerInfrastructureCoreServices(
  container: IServiceContainerRegistrar,
  tokens: Pick<
    CoreServiceRegistrationTokens,
    | 'WorkspaceRoot'
    | 'NotesRepository'
    | 'MessagesRepository'
    | 'SessionsRepository'
    | 'PlanningRepository'
    | 'LlmService'
    | 'ConfigurationStorage'
    | 'BackendLogService'
    | 'PathPermissionChecker'
    | 'DeveloperIdentityService'
    | 'SystemInfoService'
    | 'PermissionStorage'
    | 'ModelDiscoveryRegistry'
    | 'LlmProviderTester'
    | 'ProviderConfigurationService'
    | 'LlmSettingsResolver'
    | 'MarkdownSectionService'
    | 'WorkspaceStorage'
    | 'AgentDocumentStorage'
    | 'AgentManager'
    | 'SkillManager'
    | 'AvatarManager'
    | 'CodeEditManager'
    | 'TypeScriptAnalyzer'
    | 'FileAnnotationService'
    | 'FileTreeService'
    | 'FuzzyFileSearch'
    | 'IdeAdapterFactory'
    | 'WorkspaceAccessRuntime'
    | 'WorkspaceFsFactory'
    | 'NoteAttachmentReader'
    | 'ProposalStoreFactory'
    | 'TextToolCallParser'
    | 'ChatStorage'
    | 'ChatManager'
    | 'TeamGraphBuilder'
  > & {
    SqliteBackend: IContainerToken<SqliteBackend>;
    ContextRuntime: IContainerToken<ContextRuntime>;
  }
): void {
  container.registerSingleton(
    tokens.SqliteBackend,
    (c) => new SqliteBackend(c.resolve(tokens.WorkspaceRoot))
  );
  container.registerSingleton(tokens.NotesRepository, (c) => {
    const b = c.resolve(tokens.SqliteBackend);
    return new NotesRepository(c.resolve(tokens.WorkspaceRoot), b.ensureReadyAsync, b.getDb);
  });
  container.registerSingleton(tokens.MessagesRepository, (c) => {
    const b = c.resolve(tokens.SqliteBackend);
    return new MessagesRepository(b.ensureReadyAsync, b.getDb);
  });
  container.registerSingleton(tokens.SessionsRepository, (c) => {
    const b = c.resolve(tokens.SqliteBackend);
    return new SessionsRepository(b.ensureReadyAsync, b.getDb, c.resolve(tokens.NotesRepository));
  });
  container.registerSingleton(tokens.PlanningRepository, (c) => {
    const b = c.resolve(tokens.SqliteBackend);
    return new PlanningRepository(b.ensureReadyAsync, b.getDb);
  });

  container.registerSingleton(
    tokens.ConfigurationStorage,
    (c) => new ConfigurationStorage(c.resolve(tokens.WorkspaceRoot))
  );
  container.registerSingleton(tokens.LlmService, (c) => {
    const configStorage = c.resolve(tokens.ConfigurationStorage);
    const teamConfig = configStorage.get();
    return new LlmService(
      c.resolve(tokens.WorkspaceRoot),
      teamConfig,
      c.resolve(tokens.LlmSettingsResolver),
      c.resolve(tokens.BackendLogService)
    ) as unknown as ILlmService;
  });

  container.registerSingleton(
    tokens.PathPermissionChecker,
    (c) => new PathPermissionChecker(c.resolve(tokens.WorkspaceRoot))
  );
  container.registerSingleton(tokens.DeveloperIdentityService, (c) => {
    const configStorage = c.resolve(tokens.ConfigurationStorage);
    return new DeveloperIdentityService(configStorage.get('developer'));
  });
  container.registerSingleton(tokens.SystemInfoService, () => new SystemInfoService());
  container.registerSingleton(
    tokens.PermissionStorage,
    (c) => new PermFileRegistry(c.resolve(tokens.WorkspaceRoot))
  );
  container.registerSingleton(
    tokens.ModelDiscoveryRegistry,
    () =>
      new ModelDiscoveryRegistry([
        new GitHubModelDiscoveryService(),
        new OpenAICompatibleModelDiscoveryService(),
      ])
  );
  container.registerSingleton(
    tokens.LlmProviderTester,
    (c) => new LlmProviderTester(c.resolve(tokens.LlmSettingsResolver))
  );
  container.registerSingleton(tokens.ProviderConfigurationService, (c) => {
    const configStorage = c.resolve(tokens.ConfigurationStorage);
    const teamConfig = configStorage.get();
    return new ProviderConfigurationService(teamConfig);
  });
  container.registerSingleton(
    tokens.LlmSettingsResolver,
    (c) => new InfrastructureLlmSettingsResolver(c.resolve(tokens.ProviderConfigurationService))
  );

  registerAgentInfrastructureServices(container, {
    WorkspaceRoot: tokens.WorkspaceRoot,
    ConfigurationStorage: tokens.ConfigurationStorage,
    PermissionStorage: tokens.PermissionStorage,
    MarkdownSectionService: tokens.MarkdownSectionService,
    WorkspaceStorage: tokens.WorkspaceStorage,
    AgentDocumentStorage: tokens.AgentDocumentStorage,
    AgentManager: tokens.AgentManager,
    SkillManager: tokens.SkillManager,
  });

  container.registerSingleton(
    tokens.AvatarManager,
    (c) =>
      new AvatarManager(c.resolve(tokens.WorkspaceRoot), c.resolve(tokens.AgentDocumentStorage))
  );
  container.registerSingleton(tokens.CodeEditManager, () => new CodeEditManager());
  container.registerSingleton(tokens.TypeScriptAnalyzer, () => new TypeScriptAnalyzer());
  container.registerSingleton(tokens.FileAnnotationService, () => new FileAnnotationServiceImpl());
  container.registerSingleton(tokens.FileTreeService, () => new FileTreeServiceImpl());
  container.registerSingleton(
    tokens.FuzzyFileSearch,
    (c) => new InfrastructureFuzzyFileSearch(c.resolve(tokens.WorkspaceRoot))
  );
  container.registerSingleton(
    tokens.IdeAdapterFactory,
    () => new InfrastructureIdeAdapterFactory()
  );
  container.registerSingleton(
    tokens.WorkspaceAccessRuntime,
    (c) => new InfrastructureWorkspaceAccessRuntime(c.resolve(tokens.ConfigurationStorage))
  );
  container.registerSingleton(
    tokens.WorkspaceFsFactory,
    (c) => new InfrastructureWorkspaceFsFactory(c.resolve(tokens.WorkspaceRoot))
  );
  container.registerSingleton(tokens.NoteAttachmentReader, () => new NoteAttachmentReader());
  container.registerSingleton(
    tokens.ProposalStoreFactory,
    () => new InfrastructureProposalStoreFactory()
  );
  container.registerSingleton(
    tokens.TextToolCallParser,
    () => new InfrastructureTextToolCallParser()
  );
  container.registerSingleton(
    tokens.ChatStorage,
    (c) => new ChatStorage(c.resolve(tokens.WorkspaceRoot))
  );
  container.registerSingleton(
    tokens.ChatManager,
    (c) => new ChatManager(c.resolve(tokens.ChatStorage), c.resolve(tokens.WorkspaceRoot))
  );
  container.registerSingleton(
    tokens.TeamGraphBuilder,
    (c) => new TeamGraphBuilder(c.resolve(tokens.AgentManager))
  );
  container.registerSingleton(tokens.ContextRuntime, () => new ContextRuntime());
}
