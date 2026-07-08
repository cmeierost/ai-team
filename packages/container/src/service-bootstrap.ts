import { CORE_SERVICE_TOKENS, Token } from '@ai-team/core';
import type {
  ContainerTokenValueMap,
  IContainerToken,
  IServiceContainerRegistrar,
  CliCommandMetadata,
  IMessageStorage,
} from '@ai-team/core';
import { createBootstrappedContainer, type ContainerBootstrapper } from './bootstrap.js';
import type { MergeTokenSets, ServiceContainer, TokenSet } from './container.js';
import { registerInfrastructureCoreServices } from '@ai-team/infrastructure';

import {
  type ToolManager,
  type SessionManager,
  type IInteractionService,
  type SystemService,
  type AgentsService,
  type TeamService,
  type ChatService,
  type SessionsService,
  type ArtifactsService,
  type TasksService,
  type PlanningService,
  type DeveloperService,
  type FilesService,
  type IdeService,
  type SkillsService,
  type ToolsService,
  type ConfigService,
  type MetaService,
  type CommandsService,
  type AccessService,
  type ToolDispatchSupportService,
  type ToolSerializationService,
  registerServiceLayerServices,
  type ServiceLayerRegistrationTokens,
} from '@ai-team/service';

export const SERVERTokens = {} as const;

export const EXCHANGABLE_TOKENS = {} as const;

export const TOKENS = {
  // ── Exchangable / transport-local tokens ───────────────────────────────
  ApiBaseUrl: new Token<string>('ApiBaseUrl'),
  InteractionService: new Token<IInteractionService>('IInteractionService'),

  // ── Core interface-backed tokens (source of truth: @ai-team/core) ─────
  ...CORE_SERVICE_TOKENS,

  // ── Local / concrete tokens ─────────────────────────────────────────────
  MessageStorage: new Token<IMessageStorage>('MessageStorage'),
  SessionManager: new Token<SessionManager>('SessionManager'),
  ToolManager: new Token<ToolManager>('ToolManager'),
  ToolDispatchSupportService: new Token<ToolDispatchSupportService>('ToolDispatchSupportService'),
  ToolSerializationService: new Token<ToolSerializationService>('ToolSerializationService'),

  // ── HTTP route services ──────────────────────────────────────────────────

  SystemService: new Token<SystemService>('SystemService'),
  AgentsService: new Token<AgentsService>('AgentsService'),
  TeamService: new Token<TeamService>('TeamService'),
  ChatService: new Token<ChatService>('ChatService'),
  SessionsService: new Token<SessionsService>('SessionsService'),
  ArtifactsService: new Token<ArtifactsService>('ArtifactsService'),
  TasksService: new Token<TasksService>('TasksService'),
  PlanningService: new Token<PlanningService>('PlanningService'),
  DeveloperService: new Token<DeveloperService>('DeveloperService'),
  FilesService: new Token<FilesService>('FilesService'),
  IdeService: new Token<IdeService>('IdeService'),
  SkillsService: new Token<SkillsService>('SkillsService'),
  ToolsService: new Token<ToolsService>('ToolsService'),
  ConfigService: new Token<ConfigService>('ConfigService'),
  MetaService: new Token<MetaService>('MetaService'),
  CommandsService: new Token<CommandsService>('CommandsService'),
  AccessService: new Token<AccessService>('AccessService'),
  ContextRuntime: new Token<any>('ContextRuntime'),
} as const;

export const COMMAND_METADATA_BY_KEY = new Token<Map<string, CliCommandMetadata>>(
  'CommandMetadataByKey'
);

export type ServiceBootstrapTypes = ContainerTokenValueMap<typeof TOKENS>;

export interface ServiceBootstrapConfig {
  workspaceRoot: string;
  apiBaseUrl?: string;
}

export type ServiceBootstrapTokens<T extends ServiceBootstrapTypes = ServiceBootstrapTypes> = {
  [K in keyof T]: IContainerToken<T[K]>;
};

export type ExtendedServiceContainer<TSets extends readonly TokenSet[]> = ServiceContainer<
  ServiceBootstrapTypes & MergeTokenSets<TSets>
>;

function registerBaseServices(
  c: ServiceContainer<ServiceBootstrapTypes>,
  cfg: ServiceBootstrapConfig,
  tokens: ServiceBootstrapTokens<ServiceBootstrapTypes>
): void {
  c.registerSingleton(tokens.ApiBaseUrl, () => cfg.apiBaseUrl ?? 'http://localhost:3002');
  c.registerInstance(tokens.WorkspaceRoot, cfg.workspaceRoot);

  registerInfrastructureCoreServices(c as IServiceContainerRegistrar, tokens);

  registerServiceLayerServices(
    c as unknown as IServiceContainerRegistrar,
    cfg,
    tokens as unknown as ServiceLayerRegistrationTokens
  );
}

export function createContainer(
  config: ServiceBootstrapConfig
): ServiceContainer<ServiceBootstrapTypes>;
export function createContainer<const TSets extends readonly TokenSet[]>(
  config: ServiceBootstrapConfig,
  bootstrap: ContainerBootstrapper<
    ServiceBootstrapConfig,
    ServiceBootstrapTypes & MergeTokenSets<TSets>
  >,
  ...tokenSets: TSets
): ServiceContainer<ServiceBootstrapTypes & MergeTokenSets<TSets>>;
export function createContainer<const TSets extends readonly TokenSet[]>(
  config: ServiceBootstrapConfig,
  bootstrap?: ContainerBootstrapper<
    ServiceBootstrapConfig,
    ServiceBootstrapTypes & MergeTokenSets<TSets>
  >,
  ...tokenSets: TSets
): ServiceContainer<ServiceBootstrapTypes | (ServiceBootstrapTypes & MergeTokenSets<TSets>)> {
  const tokens = TOKENS as unknown as ServiceBootstrapTokens<ServiceBootstrapTypes>;

  const container = createBootstrappedContainer(
    config,
    (c, cfg) => {
      registerBaseServices(c as unknown as ServiceContainer<ServiceBootstrapTypes>, cfg, tokens);
      if (bootstrap) {
        bootstrap(c as unknown as ExtendedServiceContainer<TSets>, cfg);
      }
    },
    TOKENS,
    ...tokenSets
  ) as unknown as ServiceContainer<ServiceBootstrapTypes & MergeTokenSets<TSets>>;

  return container as unknown as ServiceContainer<
    ServiceBootstrapTypes | (ServiceBootstrapTypes & MergeTokenSets<TSets>)
  >;
}

export function createContainerWithTokenSets<const TSets extends readonly TokenSet[]>(
  config: ServiceBootstrapConfig,
  ...tokenSets: TSets
): ExtendedServiceContainer<TSets> {
  return createContainer(config, () => {}, ...tokenSets) as ExtendedServiceContainer<TSets>;
}

export function createContainerWithBootstrap<const TSets extends readonly TokenSet[]>(
  config: ServiceBootstrapConfig,
  bootstrap: (container: ExtendedServiceContainer<TSets>) => void,
  ...tokenSets: TSets
): ExtendedServiceContainer<TSets> {
  const container = createContainerWithTokenSets(config, ...tokenSets);
  bootstrap(container);
  return container;
}
