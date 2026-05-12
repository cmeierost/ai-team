import { z } from 'zod';
import type {
  ProviderListOptions,
  ProviderModelsOptions,
  RefreshProviderModelsOptions,
} from '@ai-team/api-contracts';
import type {
  ICommand,
  IConfigurationStorage,
  IEnvironmentStorage,
  IModelDiscoveryRegistry,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import { ModelsCommand } from './models.js';

type ListParams = z.infer<typeof ProviderListICommand.schema>;
type ModelsParams = z.infer<typeof ProviderModelsICommand.schema>;
type RefreshParams = z.infer<typeof ProviderModelsRefreshICommand.schema>;

export class ProviderListICommand implements ICommand<ListParams, void> {
  static readonly schema = z.object({
    json: z.boolean().optional(),
  });

  readonly key = 'providerList';
  readonly cli = { command: 'list', parentKey: 'provider' };
  readonly description = 'List configured provider profiles';
  readonly availableIn = { cli: true, chat: true };
  readonly group = 'setup';
  readonly parameters = ProviderListICommand.schema;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry
  ) {}

  async execute(payload: ListParams, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new ModelsCommand(
      this.configurationStorage,
      this.environmentStorage,
      this.modelDiscoveryRegistry
    );
    await cmd.providerListAsync(ctx.workspaceRoot, payload as ProviderListOptions);
    return { status: 'ok' };
  }
}

export class ProviderModelsICommand implements ICommand<ModelsParams, void> {
  static readonly schema = z.object({
    provider: z.string().optional(),
    json: z.boolean().optional(),
  });

  readonly key = 'providerModels';
  readonly cli = { command: 'models', parentKey: 'provider' };
  readonly description = 'List model key dictionaries';
  readonly availableIn = { cli: true, chat: true };
  readonly group = 'setup';
  readonly parameters = ProviderModelsICommand.schema;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry
  ) {}

  async execute(payload: ModelsParams, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new ModelsCommand(
      this.configurationStorage,
      this.environmentStorage,
      this.modelDiscoveryRegistry
    );
    await cmd.providerModelsAsync(ctx.workspaceRoot, payload as ProviderModelsOptions);
    return { status: 'ok' };
  }
}

export class ProviderModelsRefreshICommand implements ICommand<RefreshParams, void> {
  static readonly schema = z.object({
    provider: z.string().optional(),
  });

  readonly key = 'providerModelsRefresh';
  readonly cli = { command: 'refresh', parentKey: 'provider.models' };
  readonly description = 'Refresh model dictionary from provider endpoint';
  readonly availableIn = { cli: true, chat: true };
  readonly group = 'setup';
  readonly parameters = ProviderModelsRefreshICommand.schema;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry
  ) {}

  async execute(payload: RefreshParams, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new ModelsCommand(
      this.configurationStorage,
      this.environmentStorage,
      this.modelDiscoveryRegistry
    );
    await cmd.providerModelsRefreshAsync(
      ctx.workspaceRoot,
      payload as RefreshProviderModelsOptions
    );
    return { status: 'ok' };
  }
}
