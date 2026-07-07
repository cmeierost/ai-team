import type {
  IContainerToken,
  ICodeEditManager,
  IIdeAdapterFactory,
  ITypeScriptAnalyzer,
  IModelDiscoveryRegistry,
  ILlmProviderTester,
  IAgentManager,
  ISkillManager,
  IConfigurationStorage,
  IDeveloperIdentityService,
  ISystemInfoService,
  IPermissionStorage,
  IMarkdownSectionService,
  IWorkspaceStorage,
  ITeamGraphBuilder,
  IFileTreeService,
  IFileAnnotationService,
  IAgentDocumentStorage,
  INoteAttachmentReader,
  IPathPermissionChecker,
  IMessageStorage,
  ILlmService,
  ITextToolCallParser,
  IAvatarManager,
  IProposalStoreFactory,
  IWorkspaceFsFactory,
  ICommandRegistry,
  IProviderConfigurationService,
} from '@ai-team/core';
import type { IContextService } from '@ai-team/api-contracts';
import type { ToolManager } from './tools/tool-manager.js';
import type { SessionManager } from './session-manager.js';
import type { ToolDispatchSupportService } from './orchestrator/services/tool-dispatch-support-service.js';
import type { ToolSerializationService } from './orchestrator/services/tool-serialization-service.js';
import type { EmitService } from './orchestrator/services/emit-service.js';
import type { ToolSchemaService } from './orchestrator/services/schema-service.js';
import type { IQuestionService } from './questions/question-service.js';
import type { IWorkflowRunnerFactory } from './workflow/runner.js';

function createContainerToken<T>(id: string): IContainerToken<T> {
  return {
    id,
    toString: () => `Token(${id})`,
  };
}

export const COMMAND_FACTORY_TOKENS = {
  WorkspaceRoot: createContainerToken<string>('WorkspaceRoot'),
  AgentManager: createContainerToken<IAgentManager>('AgentManager'),
  SkillManager: createContainerToken<ISkillManager>('SkillManager'),
  ToolManager: createContainerToken<ToolManager>('ToolManager'),
  SessionManager: createContainerToken<SessionManager>('SessionManager'),
  ToolDispatchSupportService: createContainerToken<ToolDispatchSupportService>(
    'ToolDispatchSupportService'
  ),
  ToolSerializationService: createContainerToken<ToolSerializationService>(
    'ToolSerializationService'
  ),
  QuestionService: createContainerToken<IQuestionService>('QuestionService'),
  EmitService: createContainerToken<EmitService>('EmitService'),
  ToolSchemaService: createContainerToken<ToolSchemaService>('ToolSchemaService'),
  ConfigurationStorage: createContainerToken<IConfigurationStorage>('ConfigurationStorage'),
  DeveloperIdentityService: createContainerToken<IDeveloperIdentityService>(
    'DeveloperIdentityService'
  ),
  SystemInfoService: createContainerToken<ISystemInfoService>('SystemInfoService'),
  PermissionStorage: createContainerToken<IPermissionStorage>('PermissionStorage'),
  MarkdownSectionService: createContainerToken<IMarkdownSectionService>('MarkdownSectionService'),
  WorkspaceStorage: createContainerToken<IWorkspaceStorage>('WorkspaceStorage'),
  ModelDiscoveryRegistry: createContainerToken<IModelDiscoveryRegistry>('ModelDiscoveryRegistry'),
  LlmProviderTester: createContainerToken<ILlmProviderTester>('LlmProviderTester'),
  TeamGraphBuilder: createContainerToken<ITeamGraphBuilder>('TeamGraphBuilder'),
  FileTreeService: createContainerToken<IFileTreeService>('FileTreeService'),
  FileAnnotationService: createContainerToken<IFileAnnotationService>('FileAnnotationService'),
  AgentDocumentStorage: createContainerToken<IAgentDocumentStorage>('AgentDocumentStorage'),
  PathPermissionChecker: createContainerToken<IPathPermissionChecker>('PathPermissionChecker'),
  AvatarManager: createContainerToken<IAvatarManager>('AvatarManager'),
  CodeEditManager: createContainerToken<ICodeEditManager>('CodeEditManager'),
  TypeScriptAnalyzer: createContainerToken<ITypeScriptAnalyzer>('TypeScriptAnalyzer'),
  IdeAdapterFactory: createContainerToken<IIdeAdapterFactory>('IdeAdapterFactory'),
  ProposalStoreFactory: createContainerToken<IProposalStoreFactory>('ProposalStoreFactory'),
  WorkspaceFsFactory: createContainerToken<IWorkspaceFsFactory>('WorkspaceFsFactory'),
  NoteAttachmentReader: createContainerToken<INoteAttachmentReader>('NoteAttachmentReader'),
  LlmService: createContainerToken<ILlmService>('LlmService'),
  TextToolCallParser: createContainerToken<ITextToolCallParser>('TextToolCallParser'),
  ProviderConfigurationService:
    createContainerToken<IProviderConfigurationService>('ProviderConfigurationService'),
  ContextService:
    createContainerToken<Pick<IContextService, 'getContextEstimate'>>('ContextService'),
  MessageStorage: createContainerToken<IMessageStorage>('SqliteBackend'),
  CommandRegistry: createContainerToken<ICommandRegistry>('CommandRegistry'),
  WorkflowRunnerFactory: createContainerToken<IWorkflowRunnerFactory>('WorkflowRunnerFactory'),
} as const;
