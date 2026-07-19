import { CORE_SERVICE_TOKENS, Token } from '@ai-team/core';
import type {
  ContainerTokenValueMap,
  IServiceContainerRegistrar,
  CliCommandMetadata,
} from '@ai-team/core';
import { CONTRACT_SERVICE_TOKENS } from '@ai-team/api-contracts';
import { createBootstrappedContainer, type ContainerBootstrapper } from './bootstrap.js';
import type { MergeTokenSets, ServiceContainer, TokenSet } from './container.js';
import { registerInfrastructureCoreServices } from '@ai-team/infrastructure';

import { registerCommands } from '@ai-team/service';
import type { IInteractionService } from '@ai-team/api-contracts';

export const TOKENS = {
  // ── Exchangeable / transport-local tokens ──────────────────────────────
  ApiBaseUrl: new Token<string>('ApiBaseUrl'),
  InteractionService: new Token<IInteractionService>('IInteractionService'),
  ContextRuntime: new Token<any>('ContextRuntime'),

  // ── Core interface-backed tokens (source of truth: @ai-team/core) ─────
  ...CORE_SERVICE_TOKENS,

  // ── HTTP route services (contract interfaces) ──────────────────────────
  ...CONTRACT_SERVICE_TOKENS,
} as const;

export const COMMAND_METADATA_BY_KEY = new Token<Map<string, CliCommandMetadata>>(
  'CommandMetadataByKey'
);

export type ServiceBootstrapTypes = ContainerTokenValueMap<typeof TOKENS>;

export interface ServiceBootstrapConfig {
  workspaceRoot: string;
  apiBaseUrl?: string;
  executionTarget?: 'console' | 'api';
}

export type ServiceBootstrapTokens<T extends ServiceBootstrapTypes = ServiceBootstrapTypes> = {
  [K in keyof T]: Token<T[K]>;
};

export type ExtendedServiceContainer<TSets extends readonly TokenSet[]> = ServiceContainer<
  ServiceBootstrapTypes & MergeTokenSets<TSets>
>;

function registerBaseServices(
  c: ServiceContainer<ServiceBootstrapTypes>,
  cfg: ServiceBootstrapConfig,
  tokens: ServiceBootstrapTokens<ServiceBootstrapTypes>
): void {
  const executionTarget = cfg.executionTarget ?? (cfg.apiBaseUrl ? 'api' : 'console');
  c.registerSingleton(tokens.ApiBaseUrl, () => cfg.apiBaseUrl ?? 'http://localhost:3002');
  c.registerInstance(tokens.WorkspaceRoot, cfg.workspaceRoot);

  registerInfrastructureCoreServices(c as IServiceContainerRegistrar, tokens);

  process.env.AI_TEAM_RUNTIME_TARGET ??= executionTarget;

  registerCommands(c as IServiceContainerRegistrar, cfg);
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
