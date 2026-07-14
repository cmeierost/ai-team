import {
  IConfigurationStorage,
  TeamConfig,
  TeamConfigSchema,
  UserConfig,
  UserConfigSchema,
  type LlmProviderConfig,
  type ProviderConfig,
  type ConfigPath,
  type PathValue,
} from '@ai-team/core';
import * as childProcess from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';

export class ConfigurationStorage implements IConfigurationStorage {
  private cachedResolvedSettings: TeamConfig | undefined;
  private initialized = false;

  constructor(private readonly workspaceRoot: string) {}

  /** Lazy sync initialization on first read. */
  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    const effectiveConfig = this.loadEffectiveConfig();
    if (!effectiveConfig) return;

    this.hydrateDeveloperProfileFromGit();
    const envVars = this.loadMergedEnvironment(this.workspaceRoot);
    const substituted = this.substituteEnvVariablesInConfig(effectiveConfig, envVars);
    const envOverridden = this.applyEnvPathOverridesToConfig(substituted, envVars);
    const developer = this.getDeveloperProfile();
    this.cachedResolvedSettings = { ...envOverridden, ...(developer ? { developer } : {}) };
  }

  /** Get the full resolved config. */
  public get(): TeamConfig;
  /** Read a config value by dot-separated path. */
  public get<Path extends ConfigPath<TeamConfig>>(pathExpr: Path): PathValue<TeamConfig, Path>;
  public get(pathExpr?: string): any {
    this.ensureInitialized();
    if (pathExpr === undefined)
      return this.cachedResolvedSettings ?? TeamConfigSchema.parse({ version: '1' });
    return this.getByPath(this.cachedResolvedSettings ?? {}, pathExpr);
  }

  /**
   * Write a config value.
   * @param scope 'user' → config.user.json, undefined → config.json (default)
   */
  public async set<Path extends ConfigPath<TeamConfig>>(
    pathExpr: Path,
    value: PathValue<TeamConfig, Path>,
    scope?: 'user'
  ): Promise<void> {
    if (scope === 'user') {
      await this.storeUser(pathExpr, value);
    } else {
      await this.storeDefault(pathExpr, value);
    }
  }

  /** Store a secret (API key, etc.) in .env. */
  public async setSecret(name: string, value: string): Promise<void> {
    await this.storeSecred(name, value);
  }

  /* ── Private helpers (used by set / setSecret / hydrateDeveloperProfileFromGit) ── */

  private async storeUser(pathExpression: string, value: unknown): Promise<void> {
    const userConfig = this.normalizeUserConfig(this.loadUserConfig() ?? {});
    this.setByPath(userConfig, pathExpression, value);

    const pathParts = pathExpression
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);

    // Provider entries in user config require a `kind` field. When users set
    // nested provider values (e.g. providers.demo.baseUrl), inherit kind from
    // existing user/team config if not explicitly set.
    if (pathParts[0] === 'providers' && pathParts.length >= 3 && pathParts[2] !== 'kind') {
      const providerKey = pathParts[1];
      const currentKind = this.getByPath(userConfig, `providers.${providerKey}.kind`);
      if (typeof currentKind !== 'string' || currentKind.length === 0) {
        const inheritedKind =
          this.getByPath(this.loadUserConfig() ?? {}, `providers.${providerKey}.kind`) ??
          this.getByPath(this.loadTeamConfig() ?? {}, `providers.${providerKey}.kind`);
        if (typeof inheritedKind === 'string' && inheritedKind.length > 0) {
          this.setByPath(userConfig, `providers.${providerKey}.kind`, inheritedKind);
        }
      }
    }

    await this.saveUserConfigAsync(userConfig);
  }

  private async storeDefault(pathExpression: string, value: unknown): Promise<void> {
    const teamConfig = this.loadTeamConfig() ?? TeamConfigSchema.parse({ version: '1' });
    this.setByPath(teamConfig, pathExpression, value);
    await this.saveTeamConfigAsync(teamConfig);
    const userConfig = this.normalizeUserConfig(this.loadUserConfig() ?? {});
    this.deleteByPath(userConfig, pathExpression);
    await this.saveUserConfigExactAsync(userConfig);
  }

  private async storeSecred(name: string, value: string): Promise<void> {
    const envPath = this.getEnvPath();
    const envVars = this.loadDotEnvFile(envPath);
    envVars[name] = value;
    await this.saveDotEnvFileAsync(envPath, envVars);
    this.invalidateSettingsCache();
  }

  public getDeveloperProfile(): UserConfig['developer'] | undefined {
    const userConfigPath = this.getUserConfigPath();
    try {
      const content = fsSync.readFileSync(userConfigPath, 'utf-8');
      const parsed = this.normalizeUserConfig(JSON.parse(content));
      return parsed.developer;
    } catch {
      return undefined;
    }
  }

  private saveDeveloperProfile(partial: Partial<NonNullable<UserConfig['developer']>>): void {
    try {
      const userConfigPath = this.getUserConfigPath();
      let current: UserConfig = {};
      try {
        const content = fsSync.readFileSync(userConfigPath, 'utf-8');
        current = this.normalizeUserConfig(JSON.parse(content));
      } catch {
        current = {};
      }
      const existingDeveloper = current.developer ?? {};
      const mergedDeveloper = { ...existingDeveloper, ...partial };
      if (!mergedDeveloper.id && mergedDeveloper.name) {
        mergedDeveloper.id = mergedDeveloper.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }
      const next: UserConfig = { ...current, developer: mergedDeveloper };
      fsSync.mkdirSync(path.dirname(userConfigPath), { recursive: true });
      fsSync.writeFileSync(userConfigPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
      this.invalidateSettingsCache();
    } catch {
      // best-effort only
    }
  }

  private async storeValuesRecursive(
    values: Record<string, unknown>,
    scope: 'user' | 'default',
    parentPath: string = ''
  ): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      const fullPath = parentPath ? `${parentPath}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        await this.storeValuesRecursive(value as Record<string, unknown>, scope, fullPath);
        continue;
      }
      if (scope === 'user') {
        await this.storeUser(fullPath, value);
      } else {
        await this.storeDefault(fullPath, value);
      }
    }
  }

  private getTeamConfigPath(workspaceRoot: string = this.requireWorkspaceRoot()): string {
    return path.join(workspaceRoot, '.ai-team', 'config.json');
  }

  private getUserConfigPath(workspaceRoot: string = this.requireWorkspaceRoot()): string {
    return path.join(workspaceRoot, '.ai-team', 'config.user.json');
  }

  public loadEnvFile(): Record<string, string> {
    return this.loadDotEnvFile(this.getEnvPath());
  }

  public async saveEnvFileAsync(vars: Record<string, string>): Promise<void> {
    await this.saveDotEnvFileAsync(this.getEnvPath(), vars);
  }

  private getEnvPath(workspaceRoot: string = this.requireWorkspaceRoot()): string {
    return path.join(workspaceRoot, '.ai-team', '.env');
  }

  private loadTeamConfig(): TeamConfig | undefined {
    const configPath = this.getTeamConfigPath();
    try {
      const content = fsSync.readFileSync(configPath, 'utf-8');
      const data = JSON.parse(content);
      return TeamConfigSchema.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async saveTeamConfigAsync(config: TeamConfig): Promise<void> {
    const configPath = this.getTeamConfigPath();
    fsSync.mkdirSync(path.dirname(configPath), { recursive: true });
    fsSync.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    this.invalidateSettingsCache();
  }

  private loadUserConfig(): UserConfig | undefined {
    const configPath = this.getUserConfigPath();
    try {
      const content = fsSync.readFileSync(configPath, 'utf-8');
      const data = JSON.parse(content);
      return this.normalizeUserConfig(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }

  private async saveUserConfigAsync(config: UserConfig): Promise<UserConfig> {
    const configPath = this.getUserConfigPath();
    const existing = this.normalizeUserConfig(this.loadUserConfig() ?? {});
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

    const teamConfig = this.loadTeamConfig();
    const normalizedForWrite = this.pruneUserConfigAgainstTeam(merged, teamConfig);

    fsSync.mkdirSync(path.dirname(configPath), { recursive: true });
    fsSync.writeFileSync(configPath, JSON.stringify(normalizedForWrite, null, 2) + '\n', 'utf-8');
    this.invalidateSettingsCache();
    return normalizedForWrite;
  }

  private loadEffectiveConfig(): TeamConfig | undefined {
    const teamConfig = this.loadTeamConfig();
    if (!teamConfig) return undefined;

    const userConfig = this.loadUserConfig();
    if (!userConfig) return teamConfig;

    const { developer: _developer, log: userLogConfig, ...teamCompatibleUserConfig } = userConfig;

    return {
      ...teamConfig,
      ...teamCompatibleUserConfig,
      log: userLogConfig
        ? {
            ...teamConfig.log,
            ...userLogConfig,
            backend: {
              ...teamConfig.log.backend,
              ...(userLogConfig.backend ?? {}),
              targets: {
                ...(teamConfig.log.backend.targets ?? {}),
                ...((userLogConfig.backend as { targets?: Record<string, unknown> } | undefined)
                  ?.targets ?? {}),
                console: {
                  ...(teamConfig.log.backend.targets?.console ?? {}),
                  ...((
                    userLogConfig.backend as
                      | { targets?: { console?: Record<string, unknown> } }
                      | undefined
                  )?.targets?.console ?? {}),
                },
                api: {
                  ...(teamConfig.log.backend.targets?.api ?? {}),
                  ...((
                    userLogConfig.backend as
                      | { targets?: { api?: Record<string, unknown> } }
                      | undefined
                  )?.targets?.api ?? {}),
                },
              },
            },
            frontend: {
              ...teamConfig.log.frontend,
              ...(userLogConfig.frontend ?? {}),
            },
            chat: {
              ...teamConfig.log.chat,
              ...(userLogConfig.chat ?? {}),
              sessionStartupLoad: {
                ...teamConfig.log.chat.sessionStartupLoad,
                ...(userLogConfig.chat?.sessionStartupLoad ?? {}),
              },
            },
          }
        : teamConfig.log,
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

    const providersRaw = raw.providers;
    if (providersRaw && typeof providersRaw === 'object' && !Array.isArray(providersRaw)) {
      for (const [providerKey, providerValue] of Object.entries(
        providersRaw as Record<string, unknown>
      )) {
        if (!providerValue || typeof providerValue !== 'object' || Array.isArray(providerValue)) {
          continue;
        }

        const providerRecord = providerValue as Record<string, unknown>;
        const kind = providerRecord.kind;
        const isValidKind = kind === 'github-copilot' || kind === 'openai-compatible';
        if (isValidKind) {
          continue;
        }

        const looksOpenAiCompatible =
          typeof providerRecord.baseUrl === 'string' ||
          typeof providerRecord.apiKey === 'string' ||
          Array.isArray(providerRecord.models);

        (providersRaw as Record<string, unknown>)[providerKey] = {
          ...providerRecord,
          kind: looksOpenAiCompatible ? 'openai-compatible' : 'github-copilot',
        };
      }
    }

    return UserConfigSchema.parse(raw);
  }

  private requireWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  private invalidateSettingsCache(): void {
    this.initialized = false;
    this.cachedResolvedSettings = undefined;
  }

  private cloneTeamConfig(config: TeamConfig): TeamConfig {
    return structuredClone(config);
  }

  private loadMergedEnvironment(workspaceRoot: string): Record<string, string> {
    const aiTeamEnvPath = path.join(workspaceRoot, '.ai-team', '.env');
    const rootEnvPath = path.join(workspaceRoot, '.env');

    const aiTeamVars = this.loadDotEnvFile(aiTeamEnvPath);
    const rootVars = this.loadDotEnvFile(rootEnvPath);

    const merged: Record<string, string> = {
      ...aiTeamVars,
      ...rootVars,
    };

    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        merged[key] = value;
      }
    }

    return merged;
  }

  private loadDotEnvFile(filePath: string): Record<string, string> {
    try {
      const content = fsSync.readFileSync(filePath, 'utf-8');
      const vars: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        let envValue = trimmed.slice(eqIndex + 1).trim();

        if (
          (envValue.startsWith('"') && envValue.endsWith('"')) ||
          (envValue.startsWith("'") && envValue.endsWith("'"))
        ) {
          envValue = envValue.slice(1, -1);
        }

        vars[key] = envValue;
      }
      return vars;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async saveDotEnvFileAsync(filePath: string, vars: Record<string, string>): Promise<void> {
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
    const lines = ['# AI Team secrets — DO NOT commit this file', ''];
    for (const [key, value] of Object.entries(vars)) {
      lines.push(`${key}="${value}"`);
    }
    lines.push('');
    fsSync.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }

  private async saveUserConfigExactAsync(config: UserConfig): Promise<UserConfig> {
    const normalized = this.normalizeUserConfig(config);
    const teamConfig = this.loadTeamConfig();
    const normalizedForWrite = this.pruneUserConfigAgainstTeam(normalized, teamConfig);
    const configPath = this.getUserConfigPath();
    fsSync.mkdirSync(path.dirname(configPath), { recursive: true });
    fsSync.writeFileSync(configPath, JSON.stringify(normalizedForWrite, null, 2) + '\n', 'utf-8');
    this.invalidateSettingsCache();
    return normalizedForWrite;
  }

  private pruneUserConfigAgainstTeam(
    userConfig: UserConfig,
    teamConfig: TeamConfig | undefined
  ): UserConfig {
    const { developer, ...userSettings } = this.normalizeUserConfig(userConfig);
    const teamComparable = (teamConfig ?? {}) as Record<string, unknown>;
    const diff = this.deepDiffObject(userSettings, teamComparable);

    const result: Record<string, unknown> = { ...diff };
    if (developer && Object.keys(developer).length > 0) {
      result.developer = developer;
    }

    return this.normalizeUserConfig(result);
  }

  private deepDiffObject(
    userValue: Record<string, unknown>,
    teamValue: Record<string, unknown>
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(userValue)) {
      const team = teamValue[key];
      const diff = this.deepDiffValue(value, team);
      if (diff !== undefined) {
        out[key] = diff;
      }
    }

    return out;
  }

  private deepDiffValue(userValue: unknown, teamValue: unknown): unknown {
    if (teamValue === undefined) {
      return userValue;
    }

    if (
      userValue === null ||
      teamValue === null ||
      typeof userValue !== 'object' ||
      typeof teamValue !== 'object'
    ) {
      return Object.is(userValue, teamValue) ? undefined : userValue;
    }

    if (Array.isArray(userValue) || Array.isArray(teamValue)) {
      return this.areDeepEqual(userValue, teamValue) ? undefined : userValue;
    }

    const nested = this.deepDiffObject(
      userValue as Record<string, unknown>,
      teamValue as Record<string, unknown>
    );
    return Object.keys(nested).length === 0 ? undefined : nested;
  }

  private areDeepEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (typeof left !== typeof right) return false;
    if (left === null || right === null) return false;

    if (Array.isArray(left) && Array.isArray(right)) {
      return this.areArraysEqual(left, right);
    }

    if (typeof left === 'object' && typeof right === 'object') {
      return this.areObjectsEqual(
        left as Record<string, unknown>,
        right as Record<string, unknown>
      );
    }

    return false;
  }

  private areArraysEqual(left: unknown[], right: unknown[]): boolean {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (!this.areDeepEqual(left[i], right[i])) return false;
    }
    return true;
  }

  private areObjectsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);
    if (leftEntries.length !== rightEntries.length) return false;

    for (const [key, value] of leftEntries) {
      if (!(key in right)) return false;
      if (!this.areDeepEqual(value, right[key])) return false;
    }

    return true;
  }

  private substituteEnvVariablesInConfig(
    config: TeamConfig,
    envVars: Record<string, string>
  ): TeamConfig {
    const visit = (node: unknown): unknown => {
      if (typeof node === 'string') {
        return node.replace(/\$\{([A-Za-z_]\w*)\}/g, (match, varName: string) => {
          return envVars[varName] ?? match;
        });
      }

      if (Array.isArray(node)) {
        return node.map((item) => visit(item));
      }

      if (node && typeof node === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node)) {
          out[key] = visit(value);
        }
        return out;
      }

      return node;
    };

    return visit(config) as TeamConfig;
  }

  private applyEnvPathOverridesToConfig(
    config: TeamConfig,
    envVars: Record<string, string>
  ): TeamConfig {
    const nextConfig = this.cloneTeamConfig(config) as Record<string, unknown>;

    for (const [envVarName, rawValue] of Object.entries(envVars)) {
      const overridePath = this.resolveEnvOverridePath(envVarName, nextConfig);
      if (!overridePath) {
        continue;
      }

      const currentValue = this.getByPath(nextConfig, overridePath);
      const coercedValue = this.coerceEnvOverrideValue(rawValue, currentValue);
      if (coercedValue === undefined) {
        continue;
      }

      this.setByPath(nextConfig, overridePath, coercedValue);
    }

    return TeamConfigSchema.parse(nextConfig);
  }

  private resolveEnvOverridePath(
    envVarName: string,
    config: Record<string, unknown>
  ): string | undefined {
    const generated = this.buildEnvOverridePathMap(config).get(envVarName);
    if (generated) return generated;

    if (!/^[A-Z0-9_]+$/.test(envVarName) || !envVarName.includes('_')) {
      return undefined;
    }

    const inferredPath = envVarName
      .split('_')
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean)
      .join('.');

    if (!inferredPath) {
      return undefined;
    }

    return this.getByPath(config, inferredPath) !== undefined ? inferredPath : undefined;
  }

  private buildEnvOverridePathMap(config: Record<string, unknown>): Map<string, string> {
    const result = new Map<string, string>();

    const visit = (node: unknown, prefix: string): void => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        return;
      }

      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const pathExpression = prefix ? `${prefix}.${key}` : key;
        if (value === null || value === undefined) {
          continue;
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          // Schema-derived env variable convention:
          //   log.backend.file -> LOG_BACKEND_FILE
          const envVar = pathExpression.toUpperCase().replaceAll('.', '_');
          result.set(envVar, pathExpression);
          continue;
        }

        if (typeof value === 'object' && !Array.isArray(value)) {
          visit(value, pathExpression);
        }
      }
    };

    visit(config, '');
    return result;
  }

  private coerceEnvOverrideValue(rawValue: string, currentValue: unknown): unknown {
    if (typeof currentValue === 'boolean') {
      return this.parseBooleanEnvValue(rawValue);
    }

    if (typeof currentValue === 'number') {
      const parsedNumber = Number(rawValue.trim());
      return Number.isFinite(parsedNumber) ? parsedNumber : undefined;
    }

    if (typeof currentValue === 'string') {
      const normalizedCurrent = currentValue.trim().toLowerCase();
      const isLogDestinationLevel =
        normalizedCurrent === 'off' ||
        normalizedCurrent === 'error' ||
        normalizedCurrent === 'warning' ||
        normalizedCurrent === 'info' ||
        normalizedCurrent === 'debug';

      if (isLogDestinationLevel) {
        const normalizedRaw = rawValue.trim().toLowerCase();
        if (normalizedRaw === 'true' || normalizedRaw === '1' || normalizedRaw === 'on') {
          return 'info';
        }
        if (normalizedRaw === 'false' || normalizedRaw === '0' || normalizedRaw === 'off') {
          return 'off';
        }
        if (
          normalizedRaw === 'error' ||
          normalizedRaw === 'warning' ||
          normalizedRaw === 'info' ||
          normalizedRaw === 'debug'
        ) {
          return normalizedRaw;
        }
        return undefined;
      }

      return rawValue;
    }

    return undefined;
  }

  private parseBooleanEnvValue(value: string): boolean | undefined {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'on') {
      return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'off') {
      return false;
    }
    return undefined;
  }

  private getByPath(root: Record<string, unknown>, pathExpression: string): unknown {
    const pathParts = pathExpression
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (pathParts.length === 0) {
      return undefined;
    }

    let current: unknown = root;
    for (const part of pathParts) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private setByPath(root: Record<string, unknown>, pathExpression: string, value: unknown): void {
    const pathParts = pathExpression
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (pathParts.length === 0) return;

    let current: Record<string, unknown> = root;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      const next = current[part];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        const created: Record<string, unknown> = {};
        current[part] = created;
        current = created;
      } else {
        current = next as Record<string, unknown>;
      }
    }

    const leafKey = pathParts.at(-1);
    if (!leafKey) {
      return;
    }
    current[leafKey] = value;
  }

  private deleteByPath(root: Record<string, unknown>, pathExpression: string): void {
    const pathParts = pathExpression
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (pathParts.length === 0) return;

    const deleteRecursive = (obj: Record<string, unknown>, index: number): boolean => {
      const key = pathParts[index];
      if (!(key in obj)) {
        return Object.keys(obj).length === 0;
      }

      if (index === pathParts.length - 1) {
        delete obj[key];
        return Object.keys(obj).length === 0;
      }

      const next = obj[key];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        return Object.keys(obj).length === 0;
      }

      const childIsEmpty = deleteRecursive(next as Record<string, unknown>, index + 1);
      if (childIsEmpty) {
        delete obj[key];
      }

      return Object.keys(obj).length === 0;
    };

    deleteRecursive(root, 0);
  }

  private mergeProviderRegistries(
    team?: Record<string, LlmProviderConfig>,
    dev?: Record<string, ProviderConfig>
  ): Record<string, LlmProviderConfig> | undefined {
    if (!dev) return team;

    const merged: Record<string, LlmProviderConfig> = team ? { ...team } : {};

    for (const [key, devProvider] of Object.entries(dev)) {
      merged[key] = this.mergeProviderEntry(merged[key], devProvider);
    }

    return Object.keys(merged).length === 0 ? undefined : merged;
  }

  private mergeProviderEntry(
    current: LlmProviderConfig | undefined,
    incoming: ProviderConfig
  ): LlmProviderConfig {
    const nextProvider: LlmProviderConfig = current ? { ...current } : { kind: incoming.kind };

    if (incoming.defaultModel !== undefined) {
      nextProvider.defaultModel = incoming.defaultModel;
    }
    if (incoming.baseUrl !== undefined) {
      nextProvider.baseUrl = incoming.baseUrl;
    }
    if (incoming.apiKey !== undefined) {
      nextProvider.apiKey = incoming.apiKey;
    }
    if (incoming.models !== undefined) {
      nextProvider.models = incoming.models;
    }
    if (incoming.params !== undefined) {
      nextProvider.params = incoming.params;
    }
    if (incoming.contextWindow !== undefined) {
      nextProvider.contextWindow = incoming.contextWindow;
    }

    return nextProvider;
  }

  private hydrateDeveloperProfileFromGit(): void {
    const existing = this.getDeveloperProfile();
    const needsName = !existing?.name?.trim();
    const needsEmail = !existing?.email?.trim();
    if (!needsName && !needsEmail) {
      return;
    }

    let name: string | undefined;
    let email: string | undefined;

    if (needsName) {
      try {
        name =
          childProcess
            .execSync('git config user.name', {
              cwd: this.workspaceRoot,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'ignore'],
            })
            .trim() || undefined;
      } catch {
        name = undefined;
      }
    }

    if (needsEmail) {
      try {
        email =
          childProcess
            .execSync('git config user.email', {
              cwd: this.workspaceRoot,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'ignore'],
            })
            .trim() || undefined;
      } catch {
        email = undefined;
      }
    }

    const partial: Partial<NonNullable<UserConfig['developer']>> = {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
    };

    if (Object.keys(partial).length > 0) {
      this.saveDeveloperProfile(partial);
    }
  }
}
