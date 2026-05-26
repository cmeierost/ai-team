import type {
  IConfigurationStorage,
  IDeveloperIdentityService,
  IEnvironmentStorage,
} from '@ai-team/core';
import { ensureUserEnvVars as ensureServiceUserEnvVars } from '../utils/user-env.js';
import { resolveDeveloperName } from '../utils/agent-selection.js';
import { withAbortSignal } from '../utils/async-utils.js';
import { withTimeout } from '../utils/with-timeout.js';
import type { ChatRuntimeHooks } from './hooks.js';
import type { IEmitService } from './services/emit-service.js';

const PREFLIGHT_STEP_TIMEOUT_MS = 15_000;

export interface IChatPreflightService {
  resolve(
    workspaceRoot: string,
    hooks: ChatRuntimeHooks
  ): Promise<{ developerName: string | undefined }>;
}

export class ChatPreflightService implements IChatPreflightService {
  constructor(
    private readonly configurationStorage: Pick<IConfigurationStorage, 'loadEffectiveConfigAsync'>,
    private readonly environmentStorage: Pick<
      IEnvironmentStorage,
      'loadEnvFileAsync' | 'saveEnvFileAsync'
    >,
    private readonly developerIdentityService: Pick<IDeveloperIdentityService, 'getUserName'>,
    private readonly emitService: IEmitService
  ) {}

  async resolve(
    workspaceRoot: string,
    hooks: ChatRuntimeHooks
  ): Promise<{ developerName: string | undefined }> {
    const teamConfig = await this.runStep(hooks, 'Loading team configuration...', () =>
      this.configurationStorage.loadEffectiveConfigAsync(workspaceRoot)
    );

    const registry = teamConfig?.providers;
    const defaultProviderRef = registry
      ? teamConfig?.defaultModel?.provider && registry[teamConfig.defaultModel.provider]
        ? teamConfig.defaultModel.provider
        : (Object.entries(registry).find(([, cfg]) => cfg.defaultModel)?.[0] ??
          Object.keys(registry)[0])
      : undefined;
    const defaultProviderKind = defaultProviderRef
      ? registry?.[defaultProviderRef]?.kind
      : undefined;
    const defaultProviderApiKeyEnvVar = defaultProviderRef
      ? registry?.[defaultProviderRef]?.apiKeyEnvVar
      : undefined;
    const requiresApiKey = defaultProviderKind
      ? defaultProviderKind === 'openai-compatible'
      : teamConfig?.llm?.provider === 'openai-compatible';

    const env = await this.runStep(hooks, 'Validating user environment...', () =>
      ensureServiceUserEnvVars(
        workspaceRoot,
        { developerName: true, apiKey: requiresApiKey },
        { quiet: true, apiKeyEnvVar: defaultProviderApiKeyEnvVar },
        this.environmentStorage as IEnvironmentStorage
      )
    );

    const developerName = resolveDeveloperName(env) ?? this.developerIdentityService.getUserName();
    return { developerName };
  }

  private async runStep<T>(
    hooks: ChatRuntimeHooks,
    message: string,
    task: () => Promise<T>,
    timeoutMs: number = PREFLIGHT_STEP_TIMEOUT_MS
  ): Promise<T> {
    this.emitService.log('info', message);
    return withAbortSignal(
      withTimeout(
        task(),
        timeoutMs,
        `${message} timed out after ${Math.floor(timeoutMs / 1000)}s.`
      ),
      hooks.signal,
      `${message} aborted by user.`
    );
  }
}
