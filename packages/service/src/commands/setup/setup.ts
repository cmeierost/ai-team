/**
 * Setup command — LLM configuration only.
 *
 * Handles provider selection, base URL, model, API key, config save,
 * and connection test. Does NOT create agents or start onboarding.
 *
 * Both CLI and web client can drive this through the question protocol.
 */

import type {
  UserConfig,
  TeamConfig,
  IConfigurationStorage,
  IWorkspaceStorage,
  IModelDiscoveryRegistry,
  ILlmProviderTester,
  IDeveloperIdentityService,
} from '@ai-team/core';
import type { SetupOptions } from '@ai-team/api-contracts';
import { resolveEffectiveLlmSettings } from '../../llm/settings.js';
import { updateWorkspaceSettings } from '../init/update-workspace-settings.js';
import { updateGitignore } from '../init/update-gitignore.js';
import { askLlmSetup, type LlmSetupResult, type LlmSettingsIo } from '../init/llm-settings.js';
import type { IQuestionService } from '../../interaction/question-service.js';
import type { IEmitService } from '@ai-team/core';

export interface SetupCommandParams {
  workspaceRoot: string;
  options?: SetupOptions;
}

export class SetupCommand {
  private static readonly DEFAULT_SKILL_SOURCES = ['https://github.com/anthropics/skills'];

  private static toApiKeyEnvVar(providerRef: string): string {
    return `${providerRef
      .trim()
      .toUpperCase()
      .replaceAll(/[^A-Z0-9]+/g, '_')}_API_KEY`;
  }

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly workspaceStorage: IWorkspaceStorage,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly developerIdentityService: IDeveloperIdentityService,
    private readonly questionService: IQuestionService,
    private readonly emitService: IEmitService
  ) {}

  async execute(params: SetupCommandParams): Promise<void> {
    await this.runSetup(params.workspaceRoot, params.options);
  }

  async executeAsync(workspaceRoot: string, options?: SetupOptions): Promise<void> {
    await this.execute({ workspaceRoot, options });
  }

  private async runSetup(workspaceRoot: string, options: SetupOptions | undefined): Promise<void> {
    const { existingConfig, existingResolvedLlm } = await this.loadExistingLlmState();
    const { llmConfig, reusedExistingLlm } = await this.resolveLlmConfig(
      options,
      existingResolvedLlm
    );
    const { safeLlmConfig, apiKey } = await this.persistLlmConfig(
      existingConfig,
      llmConfig,
      reusedExistingLlm
    );

    await updateWorkspaceSettings(workspaceRoot);
    await updateGitignore(workspaceRoot);

    this.renderConfigSummary(llmConfig, apiKey);
    await this.testLlmConnection(safeLlmConfig, apiKey);
  }

  private buildLlmSettingsIo(): LlmSettingsIo {
    return {
      select: (request) => this.questionService.select(request),
      input: (request) => this.questionService.input(request),
      password: (request) => this.questionService.password(request),
      writeLine: (message) => this.emitService.log('info', message),
      writeWarn: (message) => this.emitService.log('warn', message),
    };
  }

  private static inferDefaultProviderRef(setup: LlmSetupResult): string {
    if (setup.provider === 'github-copilot') return 'copilot';
    const baseUrl = setup.baseUrl?.toLowerCase() ?? '';
    if (baseUrl.includes('api.openai.com')) return 'openai';
    if (baseUrl.includes('localhost')) return 'local';
    return 'personal-openai';
  }

  private static buildProviderRegistrationFromSetup(setup: LlmSetupResult): {
    providerRef: string;
    providerEntry: NonNullable<TeamConfig['providers']>[string];
    defaultModel?: NonNullable<TeamConfig['defaultModel']>;
  } {
    const providerRef = setup.providerRef || SetupCommand.inferDefaultProviderRef(setup);
    const apiKeyEnvVar = setup.apiKey ? SetupCommand.toApiKeyEnvVar(providerRef) : undefined;
    const apiKeyRef = apiKeyEnvVar ? `\${${apiKeyEnvVar}}` : undefined;

    const providerEntry: NonNullable<TeamConfig['providers']>[string] =
      setup.provider === 'github-copilot'
        ? {
            kind: 'github-copilot',
            ...(setup.model ? { defaultModel: setup.model } : {}),
            ...(setup.model ? { models: [{ name: setup.model }] } : {}),
          }
        : {
            kind: 'openai-compatible',
            ...(setup.baseUrl ? { baseUrl: setup.baseUrl } : {}),
            ...(setup.model ? { defaultModel: setup.model } : {}),
            ...(setup.model ? { models: [{ name: setup.model }] } : {}),
            ...(apiKeyRef ? { apiKey: apiKeyRef } : {}),
          };

    return {
      providerRef,
      providerEntry,
      ...(setup.model ? { defaultModel: { provider: providerRef, model: setup.model } } : {}),
    };
  }

  private static buildUserConfigFromSetup(
    setup: LlmSetupResult,
    developerIdentityService: IDeveloperIdentityService
  ): UserConfig {
    const gitDeveloperName = developerIdentityService.getUserName();
    const registration = SetupCommand.buildProviderRegistrationFromSetup(setup);

    return {
      ...(gitDeveloperName
        ? {
            developer: {
              id: developerIdentityService.toDeveloperId(gitDeveloperName),
              name: gitDeveloperName,
            },
          }
        : {}),
      defaultModel: registration.defaultModel,
      providers: {
        [registration.providerRef]: registration.providerEntry,
      },
    };
  }

  private async loadExistingLlmState(): Promise<{
    existingConfig: TeamConfig | undefined;
    existingResolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings> | undefined;
  }> {
    let existingConfig: TeamConfig | undefined;
    try {
      existingConfig = this.configurationStorage.get();
    } catch {
      existingConfig = undefined;
    }
    let existingResolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings> | undefined;
    try {
      if (existingConfig) {
        existingResolvedLlm = resolveEffectiveLlmSettings(existingConfig);
      }
    } catch {
      existingResolvedLlm = undefined;
    }
    return { existingConfig, existingResolvedLlm };
  }

  private async resolveLlmConfig(
    options: SetupOptions | undefined,
    existingResolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings> | undefined
  ): Promise<{ llmConfig: LlmSetupResult; reusedExistingLlm: boolean }> {
    if (existingResolvedLlm && !options?.force) {
      const providerLabel =
        existingResolvedLlm.config.provider === 'github-copilot'
          ? 'GitHub Copilot'
          : `OpenAI-compatible (${existingResolvedLlm.config.baseUrl ?? 'custom base URL'})`;
      this.emitService.log('info', `LLM already configured: ${providerLabel}`);
      const reconfigure = await this.questionService.confirm({
        message: 'Reconfigure LLM connection?',
        default: false,
      });
      if (!reconfigure) {
        this.emitService.log('info', 'Keeping existing LLM configuration.');
        return { llmConfig: existingResolvedLlm.config, reusedExistingLlm: true };
      }
    }

    if (options?.force && existingResolvedLlm) {
      return this.resolveWithReuse(existingResolvedLlm);
    }

    const llmConfig = await askLlmSetup(this.buildLlmSettingsIo(), this.modelDiscoveryRegistry);
    return { llmConfig, reusedExistingLlm: false };
  }

  private async resolveWithReuse(
    existingResolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings>
  ): Promise<{ llmConfig: LlmSetupResult; reusedExistingLlm: boolean }> {
    const providerLabel =
      existingResolvedLlm.config.provider === 'github-copilot'
        ? 'GitHub Copilot'
        : `OpenAI-compatible (${existingResolvedLlm.config.baseUrl ?? 'custom base URL'})`;
    const providerRefSuffix = existingResolvedLlm.providerRef
      ? ` [${existingResolvedLlm.providerRef}]`
      : '';
    this.emitService.log('info', `  Current LLM: ${providerLabel}${providerRefSuffix}`);
    const reuse = await this.questionService.confirm({
      message: 'Reuse existing default LLM connection?',
      default: true,
    });
    if (!reuse) {
      const llmConfig = await askLlmSetup(this.buildLlmSettingsIo(), this.modelDiscoveryRegistry);
      return { llmConfig, reusedExistingLlm: false };
    }

    if (existingResolvedLlm.config.provider === 'openai-compatible') {
      const existingKey = existingResolvedLlm.config.apiKey;
      if (existingKey) {
        const llmConfig: LlmSetupResult = {
          ...existingResolvedLlm.config,
          providerRef: existingResolvedLlm.providerRef,
          apiKey: existingKey,
        };
        this.emitService.log('info', 'Reusing existing OpenAI-compatible configuration.');
        return { llmConfig, reusedExistingLlm: true };
      }
      this.emitService.log('warn', 'No API key found; re-running setup...');
      const llmConfig = await askLlmSetup(this.buildLlmSettingsIo(), this.modelDiscoveryRegistry);
      return { llmConfig, reusedExistingLlm: false };
    }

    const llmConfig: LlmSetupResult = {
      ...existingResolvedLlm.config,
      providerRef: existingResolvedLlm.providerRef,
    };
    this.emitService.log('info', 'Reusing existing GitHub Copilot configuration.');
    return { llmConfig, reusedExistingLlm: true };
  }

  private async persistLlmConfig(
    existingConfig: TeamConfig | undefined,
    llmConfig: LlmSetupResult,
    reusedExistingLlm: boolean
  ): Promise<{
    safeLlmConfig: Omit<LlmSetupResult, 'apiKey' | 'providerRef'>;
    apiKey?: string;
  }> {
    await this.workspaceStorage.ensureAiTeamDirectoryAsync();
    const registration = SetupCommand.buildProviderRegistrationFromSetup(llmConfig);
    const { apiKey, providerRef: _providerRef, ...safeLlmConfig } = llmConfig;
    const teamConfig: TeamConfig = existingConfig
      ? {
          ...existingConfig,
          providers: existingConfig.providers
            ? {
                ...existingConfig.providers,
                [registration.providerRef]: registration.providerEntry,
              }
            : { [registration.providerRef]: registration.providerEntry },
          defaultModel: registration.defaultModel ?? existingConfig.defaultModel,
          skillSources: existingConfig.skillSources?.length
            ? existingConfig.skillSources
            : SetupCommand.DEFAULT_SKILL_SOURCES,
        }
      : {
          version: '0.1.0',
          log: {
            backend: {
              file: 'off',
              console: 'off',
              targets: {
                console: { file: 'off', console: 'debug' },
                api: { file: 'off', console: 'off' },
              },
              sources: {},
            },
            frontend: { file: 'off', console: 'off' },
            chat: {
              sessionStartupLoad: {
                enabled: false,
                file: 'off',
                console: 'off',
              },
            },
          },
          randomAvatarUrls: [],
          providers: { [registration.providerRef]: registration.providerEntry },
          defaultModel: registration.defaultModel,
          skillSources: SetupCommand.DEFAULT_SKILL_SOURCES,
        };
    await this.configurationStorage.set('version', teamConfig.version);
    await this.configurationStorage.set('randomAvatarUrls', teamConfig.randomAvatarUrls);
    if (teamConfig.providers) {
      await this.configurationStorage.set('providers', teamConfig.providers);
    }
    if (teamConfig.defaultModel) {
      await this.configurationStorage.set('defaultModel', teamConfig.defaultModel);
    }
    if (teamConfig.skillSources) {
      await this.configurationStorage.set('skillSources', teamConfig.skillSources);
    }
    if (apiKey && !reusedExistingLlm) {
      const envVar = SetupCommand.toApiKeyEnvVar(registration.providerRef);
      await this.configurationStorage.setSecret(envVar, apiKey);
    }
    const userConfig = SetupCommand.buildUserConfigFromSetup(
      llmConfig,
      this.developerIdentityService
    );
    if (userConfig.developer) {
      await this.configurationStorage.set('developer' as any, userConfig.developer, 'user');
    }
    if (userConfig.providers) {
      await this.configurationStorage.set('providers', userConfig.providers, 'user');
    }
    if (userConfig.defaultModel) {
      await this.configurationStorage.set('defaultModel', userConfig.defaultModel, 'user');
    }
    this.emitService.log('info', 'Saved LLM configuration.');
    return { safeLlmConfig, apiKey };
  }

  private renderConfigSummary(llmConfig: LlmSetupResult, apiKey?: string): void {
    this.emitService.log('info', '');
    this.emitService.log('info', 'LLM Configuration:');
    if (llmConfig.provider === 'github-copilot') {
      this.emitService.log('info', '  Provider: GitHub Copilot');
      if (llmConfig.model) {
        this.emitService.log('info', `  Model:    ${llmConfig.model}`);
      }
      return;
    }
    this.emitService.log('info', '  Provider: OpenAI-compatible');
    this.emitService.log('info', `  Base URL: ${llmConfig.baseUrl}`);
    if (llmConfig.model) {
      this.emitService.log('info', `  Model:    ${llmConfig.model}`);
    }
    const registration = SetupCommand.buildProviderRegistrationFromSetup(llmConfig);
    const apiKeyStatus = apiKey
      ? `saved to .ai-team/.env (${SetupCommand.toApiKeyEnvVar(registration.providerRef)})`
      : 'not set';
    this.emitService.log('info', `  API Key:  ${apiKeyStatus}`);
  }

  private async testLlmConnection(
    safeLlmConfig: Omit<LlmSetupResult, 'apiKey' | 'providerRef'>,
    apiKey?: string
  ): Promise<void> {
    this.emitService.log('info', '');
    this.emitService.log('info', 'Testing LLM connection...');
    try {
      const reply = await this.llmProviderTester.testLlmConnectionAsync(safeLlmConfig, apiKey);
      this.emitService.log('info', 'LLM connection working!');
      this.emitService.log('info', `  Response: ${reply}`);
    } catch (testError) {
      this.emitService.log(
        'error',
        `LLM connection failed: ${testError instanceof Error ? testError.message : String(testError)}`
      );
      this.emitService.log('info', '  You can retry later with: ait test-connection');
    }
  }
}
