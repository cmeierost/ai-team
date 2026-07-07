/**
 * CLI-routing wrappers for provider model commands.
 *
 * Adds `cli` routing metadata to the existing ICommand classes so the CLI
 * adapter can route `provider list`, `provider models`, and `provider refresh`
 * without duplicating any logic.
 */
import type {
  IConfigurationStorage,
  IModelDiscoveryRegistry,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import {
  ProviderListICommand as BaseList,
  ProviderModelsICommand as BaseModels,
  ProviderModelsRefreshICommand as BaseRefresh,
} from './setup-models.command.js';

export class ProviderListICommand {
  readonly cli = { command: 'list', parentKey: 'provider' } as const;
  private readonly _inner: BaseList;

  constructor(cs: IConfigurationStorage, mdr: IModelDiscoveryRegistry) {
    this._inner = new BaseList(cs, mdr);
  }

  execute(
    payload: { json?: boolean },
    _unused?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<void>> {
    return this._inner.execute(payload, ctx!);
  }
}

export class ProviderModelsCommand {
  readonly cli = { command: 'models', parentKey: 'provider' } as const;
  private readonly _inner: BaseModels;

  constructor(cs: IConfigurationStorage, mdr: IModelDiscoveryRegistry) {
    this._inner = new BaseModels(cs, mdr);
  }

  execute(
    payload: { provider?: string; json?: boolean },
    _unused?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<void>> {
    return this._inner.execute(payload, ctx!);
  }
}

export class ProviderModelsRefreshICommand {
  readonly cli = { command: 'refresh', parentKey: 'provider' } as const;
  private readonly _inner: BaseRefresh;

  constructor(cs: IConfigurationStorage, mdr: IModelDiscoveryRegistry) {
    this._inner = new BaseRefresh(cs, mdr);
  }

  execute(
    payload: { provider?: string },
    _unused?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<void>> {
    return this._inner.execute(payload, ctx!);
  }
}
