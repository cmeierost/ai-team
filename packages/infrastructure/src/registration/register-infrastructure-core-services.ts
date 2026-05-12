import type { IContainerToken, IServiceContainerRegistrar } from '@ai-team/core';
import { SqliteBackend } from '../storage/sqlite/sqlite-storage.js';
import { NotesRepository } from '../repositories/notes-repository.js';
import { MessagesRepository } from '../repositories/messages-repository.js';
import { SessionsRepository } from '../repositories/sessions-repository.js';
import { PlanningRepository } from '../repositories/planning-repository.js';
import { LlmService } from '../llm/index.js';
import { ConfigurationStorage } from '../agent/configuration-storage.js';
import { EnvironmentStorage } from '../agent/environment-storage.js';
import { PathPermissionChecker } from '../context/path-permission-checker.js';
import { DeveloperIdentityService } from '../platform/developer-identity-service.js';
import { SystemInfoService } from '../platform/system-info-service.js';
import { createModelDiscoveryRegistry } from '../llm/model-discovery.js';
import { LlmProviderTester } from '../llm/provider-tester.js';
import { PermFileRegistry } from 'fs-context';
import { registerAgentInfrastructureServices } from '../agent/register-agent-infrastructure-services.js';
import { AvatarManager } from '../agent/avatar.js';
import { CodeEditManager } from '../code-edit/index.js';
import { TypeScriptAnalyzer } from '../code-analysis/typescript-analyzer.js';
import { FileAnnotationServiceImpl, FileTreeServiceImpl, InfrastructureWorkspaceAccessRuntime, InfrastructureWorkspaceFsFactory } from '../context/index.js';
import { InfrastructureIdeAdapterFactory } from '../ide/index.js';
import { NoteAttachmentReader } from '../notes/note-attachment-reader.js';
import { InfrastructureProposalStoreFactory } from '../storage/proposal-store.js';
import { InfrastructureTextToolCallParser } from '../llm/text-tool-call-parser.js';
import { ChatStorage, ChatManager } from '../chat/index.js';
import { TeamGraphBuilder } from '../agent/team-graph-builder.js';

export interface InfrastructureCoreRegistrationTokens {
  WorkspaceRoot: IContainerToken<any>;
  SqliteBackend: IContainerToken<any>;
  NotesRepository: IContainerToken<any>;
  MessagesRepository: IContainerToken<any>;
  SessionsRepository: IContainerToken<any>;
  PlanningRepository: IContainerToken<any>;
  LlmService: IContainerToken<any>;
  ConfigurationStorage: IContainerToken<any>;
  EnvironmentStorage: IContainerToken<any>;
  PathPermissionChecker: IContainerToken<any>;
  DeveloperIdentityService: IContainerToken<any>;
  SystemInfoService: IContainerToken<any>;
  PermissionStorage: IContainerToken<any>;
  ModelDiscoveryRegistry: IContainerToken<any>;
  LlmProviderTester: IContainerToken<any>;
  MarkdownSectionService: IContainerToken<any>;
  WorkspaceStorage: IContainerToken<any>;
  AgentDocumentStorage: IContainerToken<any>;
  AgentManager: IContainerToken<any>;
  SkillManager: IContainerToken<any>;
  AvatarManager: IContainerToken<any>;
  CodeEditManager: IContainerToken<any>;
  TypeScriptAnalyzer: IContainerToken<any>;
  FileAnnotationService: IContainerToken<any>;
  FileTreeService: IContainerToken<any>;
  IdeAdapterFactory: IContainerToken<any>;
  WorkspaceAccessRuntime: IContainerToken<any>;
  WorkspaceFsFactory: IContainerToken<any>;
  NoteAttachmentReader: IContainerToken<any>;
  ProposalStoreFactory: IContainerToken<any>;
  TextToolCallParser: IContainerToken<any>;
  ChatStorage: IContainerToken<any>;
  ChatManager: IContainerToken<any>;
  TeamGraphBuilder: IContainerToken<any>;
}

export function registerInfrastructureCoreServices(
  container: IServiceContainerRegistrar,
  tokens: InfrastructureCoreRegistrationTokens
): void {
  container.registerSingleton(tokens.SqliteBackend, (c) => new SqliteBackend(c.resolve(tokens.WorkspaceRoot)));
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

  container.registerSingleton(tokens.ConfigurationStorage, () => new ConfigurationStorage());
  container.registerSingleton(tokens.EnvironmentStorage, () => new EnvironmentStorage());
  container.registerSingleton(
    tokens.LlmService,
    (c) =>
      new LlmService(
        c.resolve(tokens.WorkspaceRoot),
        c.resolve(tokens.ConfigurationStorage),
        c.resolve(tokens.EnvironmentStorage)
      )
  );

  container.registerSingleton(tokens.PathPermissionChecker, () => new PathPermissionChecker());
  container.registerSingleton(
    tokens.DeveloperIdentityService,
    (c) => new DeveloperIdentityService(c.resolve(tokens.WorkspaceRoot), c.resolve(tokens.ConfigurationStorage))
  );
  container.registerSingleton(tokens.SystemInfoService, () => new SystemInfoService());
  container.registerSingleton(tokens.PermissionStorage, (c) => new PermFileRegistry(c.resolve(tokens.WorkspaceRoot)));
  container.registerSingleton(tokens.ModelDiscoveryRegistry, () => createModelDiscoveryRegistry());
  container.registerSingleton(tokens.LlmProviderTester, (c) => new LlmProviderTester(c.resolve(tokens.EnvironmentStorage)));

  registerAgentInfrastructureServices(container, {
    WorkspaceRoot: tokens.WorkspaceRoot,
    PermissionStorage: tokens.PermissionStorage,
    MarkdownSectionService: tokens.MarkdownSectionService,
    WorkspaceStorage: tokens.WorkspaceStorage,
    AgentDocumentStorage: tokens.AgentDocumentStorage,
    AgentManager: tokens.AgentManager,
    SkillManager: tokens.SkillManager,
  });

  container.registerSingleton(tokens.AvatarManager, (c) => new AvatarManager(c.resolve(tokens.AgentDocumentStorage)));
  container.registerSingleton(tokens.CodeEditManager, () => new CodeEditManager());
  container.registerSingleton(tokens.TypeScriptAnalyzer, () => new TypeScriptAnalyzer());
  container.registerSingleton(tokens.FileAnnotationService, () => new FileAnnotationServiceImpl());
  container.registerSingleton(tokens.FileTreeService, () => new FileTreeServiceImpl());
  container.registerSingleton(tokens.IdeAdapterFactory, () => new InfrastructureIdeAdapterFactory());
  container.registerSingleton(tokens.WorkspaceAccessRuntime, () => new InfrastructureWorkspaceAccessRuntime());
  container.registerSingleton(tokens.WorkspaceFsFactory, () => new InfrastructureWorkspaceFsFactory());
  container.registerSingleton(tokens.NoteAttachmentReader, () => new NoteAttachmentReader());
  container.registerSingleton(tokens.ProposalStoreFactory, () => new InfrastructureProposalStoreFactory());
  container.registerSingleton(tokens.TextToolCallParser, () => new InfrastructureTextToolCallParser());
  container.registerSingleton(tokens.ChatStorage, (c) => new ChatStorage(c.resolve(tokens.WorkspaceRoot)));
  container.registerSingleton(tokens.ChatManager, (c) => new ChatManager(c.resolve(tokens.ChatStorage), c.resolve(tokens.WorkspaceRoot)));
  container.registerSingleton(tokens.TeamGraphBuilder, (c) => new TeamGraphBuilder(c.resolve(tokens.AgentManager)));
}
