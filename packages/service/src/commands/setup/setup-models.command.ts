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
  ICommandDescriptor,
} from '@ai-team/core';
import { ModelsCommand } from './models.js';

type ListParams = z.infer<typeof ProviderListICommand.schema>;
type ModelsParams = z.infer<typeof ProviderModelsICommand.schema>;
type RefreshParams = z.infer<typeof ProviderModelsRefreshICommand.schema>;
const _providerListICommandSchema = z.object({
  json: z.boolean().optional(),
});

export const ProviderListICommandMetadata = {
  key: 'list',
  description: 'List configured provider profiles',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  parameters: _providerListICommandSchema,
} satisfies ICommandDescriptor;

export class ProviderListICommand implements ICommand<ListParams, void> {
  static readonly schema = _providerListICommandSchema;
  readonly metadata = ProviderListICommandMetadata;

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
const _providerModelsICommandSchema = z.object({
  provider: z.string().optional(),
  json: z.boolean().optional(),
});

export const ProviderModelsICommandMetadata = {
  key: 'models',
  description: 'List model key dictionaries',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  parameters: _providerModelsICommandSchema,
} satisfies ICommandDescriptor;

export class ProviderModelsICommand implements ICommand<ModelsParams, void> {
  static readonly schema = _providerModelsICommandSchema;
  readonly metadata = ProviderModelsICommandMetadata;

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
const _providerModelsRefreshICommandSchema = z.object({
  provider: z.string().optional(),
});

export const ProviderModelsRefreshICommandMetadata = {
  key: 'refresh',
  description: 'Refresh model dictionary from provider endpoint',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  parameters: _providerModelsRefreshICommandSchema,
} satisfies ICommandDescriptor;

export class ProviderModelsRefreshICommand implements ICommand<RefreshParams, void> {
  static readonly schema = _providerModelsRefreshICommandSchema;
  readonly metadata = ProviderModelsRefreshICommandMetadata;

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
