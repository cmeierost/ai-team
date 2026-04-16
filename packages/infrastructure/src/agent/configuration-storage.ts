import {
  IConfigurationStorage,
  TeamConfig,
  TeamConfigSchema,
  UserConfig,
  UserConfigSchema,
  type LlmProviderConfig,
  type ProviderConfig,
} from '@ai-team/core';
import fs from 'node:fs/promises';
import path from 'node:path';

export class ConfigurationStorage implements IConfigurationStorage {
  public getConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.ai-team', 'config.json');
  }

  public async loadTeamConfigAsync(workspaceRoot: string): Promise<TeamConfig | undefined> {
    const configPath = this.getConfigPath(workspaceRoot);
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const data = JSON.parse(content);
      return TeamConfigSchema.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  public async saveTeamConfigAsync(workspaceRoot: string, config: TeamConfig): Promise<void> {
    const configPath = this.getConfigPath(workspaceRoot);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }

  public getUserConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.ai-team', 'config.user.json');
  }

  public async loadUserConfigAsync(workspaceRoot: string): Promise<UserConfig | undefined> {
    const configPath = this.getUserConfigPath(workspaceRoot);
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const data = JSON.parse(content);
      return this.normalizeUserConfig(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }

  public async saveUserConfigAsync(workspaceRoot: string, config: UserConfig): Promise<UserConfig> {
    const configPath = this.getUserConfigPath(workspaceRoot);
    const existing = this.normalizeUserConfig(
      (await this.loadUserConfigAsync(workspaceRoot)) ?? {}
    );
    const incoming = this.normalizeUserConfig(config);

    const merged: UserConfig = {
      ...existing,
      ...incoming,
      ...(existing.developer || incoming.developer
        ? { developer: { ...existing.developer, ...incoming.developer } }
        : {}),
      ...(existing.providers || incoming.providers
        ? { providers: { ...existing.providers, ...incoming.providers } }
        : {}),
      ...(existing.modelKeys || incoming.modelKeys
        ? { modelKeys: { ...existing.modelKeys, ...incoming.modelKeys } }
        : {}),
      ...(existing.systemModels || incoming.systemModels
        ? { systemModels: { ...existing.systemModels, ...incoming.systemModels } }
        : {}),
    };

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

    return merged;
  }

  public async loadEffectiveConfigAsync(workspaceRoot: string): Promise<TeamConfig | undefined> {
    const teamConfig = await this.loadTeamConfigAsync(workspaceRoot);
    if (!teamConfig) return undefined;

    const userConfig = await this.loadUserConfigAsync(workspaceRoot);
    if (!userConfig) return teamConfig;

    return {
      ...teamConfig,
      providers: this.mergeProviderRegistries(teamConfig.providers, userConfig.providers),
      defaultModel: userConfig.defaultModel ?? teamConfig.defaultModel,
      modelKeys: userConfig.modelKeys
        ? { ...teamConfig.modelKeys, ...userConfig.modelKeys }
        : teamConfig.modelKeys,
      systemModels: userConfig.systemModels
        ? { ...teamConfig.systemModels, ...userConfig.systemModels }
        : teamConfig.systemModels,
    };
  }

  private normalizeUserConfig(input: unknown): UserConfig {
    if (!input || typeof input !== 'object') return {};
    const raw = input as Record<string, unknown>;

    const llmObj = raw.llm;
    if (llmObj && typeof llmObj === 'object') {
      const llm = llmObj as Record<string, unknown>;
      const hasOldNesting = 'providers' in llm || 'modelKeys' in llm || 'systemModels' in llm;
      if (hasOldNesting) {
        const flattened = { ...raw };
        if (llm.providers && !raw.providers) flattened.providers = llm.providers;
        if (llm.systemModels && !raw.systemModels) flattened.systemModels = llm.systemModels;
        delete flattened.llm;
        return UserConfigSchema.parse(flattened);
      }
    }

    return UserConfigSchema.parse(raw);
  }

  private mergeProviderRegistries(
    team?: Record<string, LlmProviderConfig>,
    dev?: Record<string, ProviderConfig>
  ): Record<string, LlmProviderConfig> | undefined {
    if (!dev) return team;
    if (!team && !dev) return undefined;
    const merged: Record<string, LlmProviderConfig> = { ...(team ?? {}) };

    for (const [key, devProvider] of Object.entries(dev)) {
      if (merged[key]) {
        merged[key] = {
          ...merged[key],
          ...(devProvider.defaultModel !== undefined
            ? { defaultModel: devProvider.defaultModel }
            : {}),
          ...(devProvider.baseUrl !== undefined ? { baseUrl: devProvider.baseUrl } : {}),
          ...(devProvider.apiKeyEnvVar !== undefined
            ? { apiKeyEnvVar: devProvider.apiKeyEnvVar }
            : {}),
          ...(devProvider.models !== undefined ? { models: devProvider.models } : {}),
        };
      } else {
        merged[key] = {
          kind: devProvider.kind,
          ...(devProvider.defaultModel !== undefined
            ? { defaultModel: devProvider.defaultModel }
            : {}),
          ...(devProvider.models !== undefined ? { models: devProvider.models } : {}),
          ...(devProvider.baseUrl !== undefined ? { baseUrl: devProvider.baseUrl } : {}),
          ...(devProvider.apiKeyEnvVar !== undefined
            ? { apiKeyEnvVar: devProvider.apiKeyEnvVar }
            : {}),
          ...(devProvider.params !== undefined ? { params: devProvider.params } : {}),
          ...(devProvider.contextWindow !== undefined
            ? { contextWindow: devProvider.contextWindow }
            : {}),
        };
      }
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
  }
}
