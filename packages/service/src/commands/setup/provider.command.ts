/**
 * CLI-routing wrappers for provider setup commands.
 *
 * Adds `key` and `cli` routing metadata and removes the `questionService`
 * dependency from the constructor — callers that supply `payload.setup` bypass
 * interactive prompts entirely, so no real question service is needed.
 */
import type {
  IConfigurationStorage,
  IEnvironmentStorage,
  ILlmProviderTester,
  IModelDiscoveryRegistry,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { IQuestionService } from '../../questions/question-service.js';
import {
  ProviderConfigureICommand as BaseConfigureCmd,
  ProviderAddICommand as BaseAddCmd,
  ProviderSetICommand as BaseSetCmd,
} from './setup-provider.command.js';

/**
 * A stub question service used when `payload.setup` is provided, meaning all
 * interactive steps are skipped automatically by the underlying command.
 */
const _noopQuestionService: IQuestionService = {
  confirm: () => Promise.reject(new Error('questionService not available in non-interactive mode')),
  select: () => Promise.reject(new Error('questionService not available in non-interactive mode')),
  text: () => Promise.reject(new Error('questionService not available in non-interactive mode')),
} as unknown as IQuestionService;

export class ProviderConfigureICommand {
  readonly key = 'providerConfigure';
  readonly cli = { command: 'configure', parentKey: 'provider' } as const;
  private readonly _inner: BaseConfigureCmd;

  constructor(
    cs: IConfigurationStorage,
    es: IEnvironmentStorage,
    tester: ILlmProviderTester,
    mdr: IModelDiscoveryRegistry
  ) {
    this._inner = new BaseConfigureCmd(cs, es, tester, mdr, _noopQuestionService);
  }

  execute(
    payload: Record<string, unknown>,
    _unused?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<void>> {
    return this._inner.execute(payload as Parameters<BaseConfigureCmd['execute']>[0], ctx!);
  }
}

export class ProviderAddICommand {
  readonly key = 'providerAdd';
  readonly cli = { command: 'add', parentKey: 'provider' } as const;
  private readonly _inner: BaseAddCmd;

  constructor(
    cs: IConfigurationStorage,
    es: IEnvironmentStorage,
    tester: ILlmProviderTester,
    mdr: IModelDiscoveryRegistry
  ) {
    this._inner = new BaseAddCmd(cs, es, tester, mdr, _noopQuestionService);
  }

  execute(
    payload: Record<string, unknown>,
    _unused?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<void>> {
    return this._inner.execute(payload as Parameters<BaseAddCmd['execute']>[0], ctx!);
  }
}

export class ProviderSetICommand {
  readonly key = 'providerSet';
  readonly cli = { command: 'set', parentKey: 'provider' } as const;
  private readonly _inner: BaseSetCmd;

  constructor(
    cs: IConfigurationStorage,
    es: IEnvironmentStorage,
    tester: ILlmProviderTester,
    mdr: IModelDiscoveryRegistry
  ) {
    this._inner = new BaseSetCmd(cs, es, tester, mdr, _noopQuestionService);
  }

  execute(
    payload: Record<string, unknown>,
    _unused?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<void>> {
    return this._inner.execute(payload as Parameters<BaseSetCmd['execute']>[0], ctx!);
  }
}
