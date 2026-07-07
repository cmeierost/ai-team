import type {
  TeamConfig,
  IConfigurationStorage,
  IDeveloperIdentityService,
  IProviderConfigurationService,
} from '@ai-team/core';
import { ServiceDomainError } from '../errors.js';
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
    private readonly teamConfig: TeamConfig,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly developerIdentityService: Pick<IDeveloperIdentityService, 'getUserName'>,
    private readonly emitService: IEmitService,
    private readonly providerConfigurationService: IProviderConfigurationService
  ) {}

  async resolve(
    _workspaceRoot: string,
    hooks: ChatRuntimeHooks
  ): Promise<{ developerName: string | undefined }> {
    const teamConfig = this.teamConfig;

    const defaultProvider = this.providerConfigurationService.resolveDefaultProvider(teamConfig);
    const defaultProviderKind = defaultProvider?.config.kind;
    const requiresApiKey = defaultProviderKind
      ? defaultProviderKind === 'openai-compatible'
      : false;

    await this.runStep(hooks, 'Validating user environment...', async () => {
      if (!requiresApiKey) {
        return;
      }

      const providerApiKey = defaultProvider?.config.apiKey;

      if (typeof providerApiKey === 'string' && providerApiKey.trim().length > 0) {
        return;
      }

      const envVarName = this.extractEnvVarName(providerApiKey);
      throw new ServiceDomainError(
        'INPUT_REQUIRED',
        `Missing API key. Set ${envVarName} in .ai-team/.env and reference it via config (e.g. \${${envVarName}}).`,
        { envVar: envVarName },
        {
          kind: 'env-var',
          key: envVarName,
          prompt: `Enter API key for ${envVarName}:`,
        }
      );
    });

    const developerName = this.developerIdentityService.getUserName();
    return { developerName };
  }

  private extractEnvVarName(apiKeyValue: string | undefined): string {
    if (!apiKeyValue) {
      return 'LLM_API_KEY';
    }

    const match = /^\$\{([A-Za-z_]\w*)\}$/.exec(apiKeyValue.trim());
    return match?.[1] ?? 'LLM_API_KEY';
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
