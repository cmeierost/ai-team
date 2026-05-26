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
  IEnvironmentStorage,
  IWorkspaceStorage,
  IModelDiscoveryRegistry,
  ILlmProviderTester,
  IDeveloperIdentityService,
  ExecutionContext,
} from '@ai-team/core';
import type { SetupOptions } from '@ai-team/api-contracts';
import { resolveEffectiveLlmSettings } from '@ai-team/core';
import { updateWorkspaceSettings } from '../init/update-workspace-settings.js';
import { updateGitignore } from '../init/update-gitignore.js';
import { askLlmSetup, type LlmSetupResult, type LlmSettingsIo } from '../init/llm-settings.js';
import type { IQuestionService } from '../../questions/question-service.js';

export interface SetupCommandParams {
  workspaceRoot: string;
  options?: SetupOptions;
}

export class SetupCommand {
  private static readonly DEFAULT_SKILL_SOURCES = ['https://github.com/anthropics/skills'];

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly workspaceStorage: IWorkspaceStorage,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly developerIdentityService: IDeveloperIdentityService,
    private readonly questionService: IQuestionService
  ) {}

  async execute(params: SetupCommandParams, context: ExecutionContext): Promise<void> {
    await this.runSetup(params.workspaceRoot, params.options, context);
  }

  async executeAsync(
    workspaceRoot: string,
    options?: SetupOptions,
    context?: ExecutionContext
  ): Promise<void> {
    await this.execute({ workspaceRoot, options }, context as ExecutionContext);
  }

  private async runSetup(
    workspaceRoot: string,
    options: SetupOptions | undefined,
    context: ExecutionContext
  ): Promise<void> {
    const { existingConfig, existingResolvedLlm } = await this.loadExistingLlmState(workspaceRoot);
    const { llmConfig, reusedExistingLlm } = await this.resolveLlmConfig(
      workspaceRoot,
      options,
      context,
      existingResolvedLlm
    );
    const { safeLlmConfig, apiKey } = await this.persistLlmConfig(
      workspaceRoot,
      context,
      existingConfig,
      llmConfig,
      reusedExistingLlm
    );

    await updateWorkspaceSettings(workspaceRoot);
    await updateGitignore(workspaceRoot);

    this.renderConfigSummary(context, llmConfig, apiKey);
    await this.testLlmConnection(context, safeLlmConfig, apiKey);
  }

  private writeLine(context: ExecutionContext | undefined, message: string) {
    context?.emit?.({ kind: 'log', level: 'info', message } as any);
    if (!context?.emit) {
      process.stdout.write(`${message}\n`);
    }
  }

  private writeWarn(context: ExecutionContext | undefined, message: string) {
    context?.emit?.({ kind: 'log', level: 'warn', message } as any);
    if (!context?.emit) {
      process.stdout.write(`${message}\n`);
    }
  }

  private writeError(context: ExecutionContext | undefined, message: string) {
    context?.emit?.({ kind: 'log', level: 'error', message } as any);
    if (!context?.emit) {
      process.stderr.write(`${message}\n`);
    }
  }

  private buildLlmSettingsIo(context: ExecutionContext | undefined): LlmSettingsIo {
    return {
      select: (request) => this.questionService.select(request),
      input: (request) => this.questionService.input(request),
      password: (request) => this.questionService.password(request),
      writeLine: (message) => this.writeLine(context, message),
      writeWarn: (message) => this.writeWarn(context, message),
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
    const apiKeyEnvVar = setup.apiKeyEnvVar || (setup.apiKey ? 'AI_TEAM_LLM_API_KEY' : undefined);

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
            ...(apiKeyEnvVar ? { apiKeyEnvVar } : {}),
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

  private async loadExistingLlmState(workspaceRoot: string): Promise<{
    existingConfig: TeamConfig | undefined;
    existingResolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings> | undefined;
  }> {
    const existingConfig = await this.configurationStorage.loadTeamConfigAsync(workspaceRoot);
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
    workspaceRoot: string,
    options: SetupOptions | undefined,
    context: ExecutionContext,
    existingResolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings> | undefined
  ): Promise<{ llmConfig: LlmSetupResult; reusedExistingLlm: boolean }> {
    if (existingResolvedLlm && !options?.force) {
      const providerLabel =
        existingResolvedLlm.config.provider === 'github-copilot'
          ? 'GitHub Copilot'
          : `OpenAI-compatible (${existingResolvedLlm.config.baseUrl ?? 'custom base URL'})`;
      this.writeLine(context, `LLM already configured: ${providerLabel}`);
      const reconfigure = await this.questionService.confirm({
        message: 'Reconfigure LLM connection?',
        default: false,
      });
      if (!reconfigure) {
        this.writeLine(context, 'Keeping existing LLM configuration.');
        return { llmConfig: existingResolvedLlm.config, reusedExistingLlm: true };
      }
    }

    if (options?.force && existingResolvedLlm) {
      return this.resolveWithReuse(workspaceRoot, context, existingResolvedLlm);
    }

    const llmConfig = await askLlmSetup(
      this.buildLlmSettingsIo(context),
      this.modelDiscoveryRegistry
    );
    return { llmConfig, reusedExistingLlm: false };
  }

  private async resolveWithReuse(
    workspaceRoot: string,
    context: ExecutionContext,
    existingResolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings>
  ): Promise<{ llmConfig: LlmSetupResult; reusedExistingLlm: boolean }> {
    const providerLabel =
      existingResolvedLlm.config.provider === 'github-copilot'
        ? 'GitHub Copilot'
        : `OpenAI-compatible (${existingResolvedLlm.config.baseUrl ?? 'custom base URL'})`;
    const providerRefSuffix = existingResolvedLlm.providerRef
      ? ` [${existingResolvedLlm.providerRef}]`
      : '';
    this.writeLine(context, `  Current LLM: ${providerLabel}${providerRefSuffix}`);
    const reuse = await this.questionService.confirm({
      message: 'Reuse existing default LLM connection?',
      default: true,
    });
    if (!reuse) {
      const llmConfig = await askLlmSetup(
        this.buildLlmSettingsIo(context),
        this.modelDiscoveryRegistry
      );
      return { llmConfig, reusedExistingLlm: false };
    }

    if (existingResolvedLlm.config.provider === 'openai-compatible') {
      const envVars = await this.environmentStorage.loadEnvFileAsync(workspaceRoot);
      const keyEnvVar = existingResolvedLlm.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
      const existingKey =
        envVars[keyEnvVar] ||
        envVars['AI_TEAM_LLM_API_KEY'] ||
        envVars['LLM_API_KEY'] ||
        envVars['OPENAI_API_KEY'];
      if (existingKey) {
        const llmConfig: LlmSetupResult = {
          ...existingResolvedLlm.config,
          providerRef: existingResolvedLlm.providerRef,
          apiKeyEnvVar: keyEnvVar,
          apiKey: existingKey,
        };
        this.writeLine(context, 'Reusing existing OpenAI-compatible configuration.');
        return { llmConfig, reusedExistingLlm: true };
      }
      this.writeWarn(context, 'No API key found; re-running setup...');
      const llmConfig = await askLlmSetup(
        this.buildLlmSettingsIo(context),
        this.modelDiscoveryRegistry
      );
      return { llmConfig, reusedExistingLlm: false };
    }

    const llmConfig: LlmSetupResult = {
      ...existingResolvedLlm.config,
      providerRef: existingResolvedLlm.providerRef,
    };
    this.writeLine(context, 'Reusing existing GitHub Copilot configuration.');
    return { llmConfig, reusedExistingLlm: true };
  }

  private async persistLlmConfig(
    workspaceRoot: string,
    context: ExecutionContext,
    existingConfig: TeamConfig | undefined,
    llmConfig: LlmSetupResult,
    reusedExistingLlm: boolean
  ): Promise<{
    safeLlmConfig: Omit<LlmSetupResult, 'apiKey' | 'providerRef' | 'apiKeyEnvVar'>;
    apiKey?: string;
  }> {
    await this.workspaceStorage.ensureAiTeamDirectoryAsync(workspaceRoot);
    const registration = SetupCommand.buildProviderRegistrationFromSetup(llmConfig);
    const {
      apiKey,
      providerRef: _providerRef,
      apiKeyEnvVar: _apiKeyEnvVar,
      ...safeLlmConfig
    } = llmConfig;
    const teamConfig: TeamConfig = existingConfig
      ? {
          ...existingConfig,
          llm: safeLlmConfig,
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
          randomAvatarUrls: [],
          llm: safeLlmConfig,
          providers: { [registration.providerRef]: registration.providerEntry },
          defaultModel: registration.defaultModel,
          skillSources: SetupCommand.DEFAULT_SKILL_SOURCES,
        };
    await this.configurationStorage.saveTeamConfigAsync(workspaceRoot, teamConfig);
    if (apiKey && !reusedExistingLlm) {
      await this.environmentStorage.saveEnvFileAsync(workspaceRoot, {
        [llmConfig.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY']: apiKey,
      });
    }
    await this.configurationStorage.saveUserConfigAsync(
      workspaceRoot,
      SetupCommand.buildUserConfigFromSetup(llmConfig, this.developerIdentityService)
    );
    this.writeLine(context, 'Saved LLM configuration.');
    return { safeLlmConfig, apiKey };
  }

  private renderConfigSummary(
    context: ExecutionContext,
    llmConfig: LlmSetupResult,
    apiKey?: string
  ): void {
    this.writeLine(context, '');
    this.writeLine(context, 'LLM Configuration:');
    if (llmConfig.provider === 'github-copilot') {
      this.writeLine(context, '  Provider: GitHub Copilot');
      if (llmConfig.model) {
        this.writeLine(context, `  Model:    ${llmConfig.model}`);
      }
      return;
    }
    this.writeLine(context, '  Provider: OpenAI-compatible');
    this.writeLine(context, `  Base URL: ${llmConfig.baseUrl}`);
    if (llmConfig.model) {
      this.writeLine(context, `  Model:    ${llmConfig.model}`);
    }
    const apiKeyStatus = apiKey
      ? `saved to .ai-team/.env (${llmConfig.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY'})`
      : 'not set';
    this.writeLine(context, `  API Key:  ${apiKeyStatus}`);
  }

  private async testLlmConnection(
    context: ExecutionContext,
    safeLlmConfig: Omit<LlmSetupResult, 'apiKey' | 'providerRef' | 'apiKeyEnvVar'>,
    apiKey?: string
  ): Promise<void> {
    this.writeLine(context, '');
    this.writeLine(context, 'Testing LLM connection...');
    try {
      const reply = await this.llmProviderTester.testLlmConnectionAsync(safeLlmConfig, apiKey);
      this.writeLine(context, 'LLM connection working!');
      this.writeLine(context, `  Response: ${reply}`);
    } catch (testError) {
      this.writeError(
        context,
        `LLM connection failed: ${testError instanceof Error ? testError.message : String(testError)}`
      );
      this.writeLine(context, '  You can retry later with: ait test-connection');
    }
  }
}
