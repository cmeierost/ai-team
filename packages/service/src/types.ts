import type {
  IContainerToken,
  IServiceContainer,
  ICodeEditManager,
  IIdeAdapterFactory,
  ITypeScriptAnalyzer,
  IModelDiscoveryRegistry,
  ILlmProviderTester,
  IAgentManager,
  ISkillManager,
  IConfigurationStorage,
  IEnvironmentStorage,
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
  CliCommandMetadata,
  ICommandRegistry,
} from '@ai-team/core';
import type { IContextService } from '@ai-team/api-contracts';
import type { CommandRegistrationMetadata, RegisteredCommand } from './command-dispatcher.js';
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
  EnvironmentStorage: createContainerToken<IEnvironmentStorage>('EnvironmentStorage'),
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
  ContextService:
    createContainerToken<Pick<IContextService, 'getContextEstimate'>>('ContextService'),
  MessageStorage: createContainerToken<IMessageStorage>('SqliteBackend'),
  CommandRegistry: createContainerToken<ICommandRegistry>('CommandRegistry'),
  WorkflowRunnerFactory: createContainerToken<IWorkflowRunnerFactory>('WorkflowRunnerFactory'),
} as const;

export interface CommandFactoryContainer {
  workspaceRoot: string;
  resolver: IServiceContainer;
  resolve<T>(token: IContainerToken<T>): T;
  registerTransient<T>(
    token: IContainerToken<T>,
    factory: (resolver: IServiceContainer) => T
  ): void;
}

export type CommandFactory<TCommand extends string = string> = (
  container: CommandFactoryContainer
) => RegisteredCommand<TCommand>;

export type CurriedCommandHandler<TCommand extends string = string> = (
  payload: Parameters<RegisteredCommand<TCommand>['handler']>[1],
  context: Parameters<RegisteredCommand<TCommand>['handler']>[2]
) => ReturnType<RegisteredCommand<TCommand>['handler']>;

export interface ResolverCommandDefinition<TCommand extends string = string> {
  registration: CommandRegistrationMetadata<TCommand>;
  handlerToken: IContainerToken<CurriedCommandHandler<TCommand>>;
  register(container: CommandFactoryContainer): void;
  cliMetadata?: CliCommandMetadata;
}

export interface FactoryCommandDefinition<TCommand extends string = string> {
  factory: CommandFactory<TCommand>;
  cliMetadata?: CliCommandMetadata;
}

export type CommandDefinition<TCommand extends string = string> =
  | FactoryCommandDefinition<TCommand>
  | ResolverCommandDefinition<TCommand>;

export type AnyCommandDefinition = CommandDefinition<any>;
export type CommandDefinitionSet = ReadonlyArray<AnyCommandDefinition>;

export interface CommandDefinitionRegistry {
  add(...definitions: AnyCommandDefinition[]): void;
  list(): CommandDefinitionSet;
}

export const COMMAND_DEFINITION_REGISTRY_TOKEN =
  createContainerToken<CommandDefinitionRegistry>('CommandDefinitions');

export function createCommandDefinitionRegistry(
  initialDefinitions: CommandDefinitionSet = []
): CommandDefinitionRegistry {
  const definitions = [...initialDefinitions];
  const resolverDefinitionKeys = new Set<string>();

  const addIfResolverDefinition = (definition: AnyCommandDefinition): void => {
    if (!isResolverCommandDefinition(definition)) {
      return;
    }

    const key = String(definition.registration.key);
    if (resolverDefinitionKeys.has(key)) {
      throw new Error(`Duplicate command definition key '${key}' in CommandDefinitionRegistry.`);
    }

    resolverDefinitionKeys.add(key);
  };

  for (const definition of definitions) {
    addIfResolverDefinition(definition);
  }

  return {
    add: (...nextDefinitions) => {
      for (const definition of nextDefinitions) {
        addIfResolverDefinition(definition);
      }
      definitions.push(...nextDefinitions);
    },
    list: () => [...definitions],
  };
}

export function isResolverCommandDefinition<TCommand extends string>(
  definition: CommandDefinition<TCommand>
): definition is ResolverCommandDefinition<TCommand> {
  return 'register' in definition && 'handlerToken' in definition && 'registration' in definition;
}

export function createCommandHandlerToken<TCommand extends string>(
  key: TCommand
): IContainerToken<CurriedCommandHandler<TCommand>> {
  return createContainerToken<CurriedCommandHandler<TCommand>>(`CommandHandler:${String(key)}`);
}
