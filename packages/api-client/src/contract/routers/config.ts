import type { ApiDescription } from '@ts-http/core';

// ─── LLM config DTOs ─────────────────────────────────────────────────────────

export interface LlmGenerationParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
}

export interface LlmProfile {
  provider?: string;
  modelKey?: string;
  model?: string;
  baseUrl?: string;
  params?: LlmGenerationParams;
}

export interface LlmConfig {
  provider: string;
  model?: string;
  baseUrl?: string;
  params?: LlmGenerationParams;
}

export type LlmProvider = 'github-copilot' | 'openai-compatible';

export interface ProviderModel {
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}

export interface LlmProviderConfig {
  kind: LlmProvider;
  defaultModel?: string;
  models?: ProviderModel[];
  imageModels?: Record<string, string>;
  baseUrl?: string;
  apiKeyEnvVar?: string;
  params?: LlmGenerationParams;
  contextWindow?: number;
}

// ─── Config DTOs ─────────────────────────────────────────────────────────────

export interface ModelKeyEntry {
  provider: string;
  model: string;
  contextWindow?: number;
  params?: LlmGenerationParams;
}

export interface TeamConfig {
  version: string;
  projectName?: string;
  llm?: LlmConfig;
  providers?: Record<string, LlmProviderConfig>;
  defaultModel?: { provider: string; model: string; contextWindow?: number };
  skillSources?: string[];
  allowedCliTools?: string[];
  avatarStyle?: 'professional-headshot' | 'avatar' | 'illustrated';
  randomAvatarUrls?: string[];
  fileTree?: { readPaths?: string[]; writePaths?: string[] };
  fileTypeGroups?: Record<string, { label?: string; patterns?: string[]; extensions?: string[] }>;
  modelKeys?: Record<string, ModelKeyEntry>;
  systemModels?: Record<
    string,
    { provider?: string; modelKey?: string; model?: string; contextWindow?: number }
  >;
}

export interface UserProfile {
  id?: string;
  name?: string;
  email?: string;
  avatar?: string;
  portfolioUrl?: string;
}

export interface UserConfig {
  version?: string;
  llm?: LlmConfig;
  providers?: Record<string, LlmProviderConfig>;
  defaultModel?: { provider: string; model: string; contextWindow?: number };
  skillSources?: string[];
  allowedCliTools?: string[];
  avatarStyle?: 'professional-headshot' | 'avatar' | 'illustrated';
  randomAvatarUrls?: string[];
  fileTree?: { readPaths?: string[]; writePaths?: string[] };
  fileTypeGroups?: Record<string, { label?: string; patterns?: string[]; extensions?: string[] }>;
  modelKeys?: Record<string, ModelKeyEntry>;
  systemModels?: Record<
    string,
    { provider?: string; modelKey?: string; model?: string; contextWindow?: number }
  >;
  developer?: UserProfile;
}

export interface IConfigService {
  getConfig(): Promise<TeamConfig>;
  updateConfig(body: Partial<TeamConfig>): Promise<TeamConfig>;
  getAgentModelKeys(): Promise<{ usedKeys: string[]; keysByAgent: Record<string, string> }>;
  getUserConfig(): Promise<UserConfig>;
  saveUserConfig(body: Partial<UserConfig>): Promise<UserConfig>;
  testProviderConnection(
    providerRef: string
  ): Promise<{ ok: boolean; latencyMs?: number; error?: string; message?: string }>;
  refreshUserProviderModels(providerRef: string): Promise<unknown>;
  refreshProviderModels(providerRef: string): Promise<unknown>;
  getEnvStatus(): Promise<Record<string, boolean>>;
  setEnvVar(body: { key: string; value: string }): Promise<{ ok: boolean }>;
}

export const configDesc: ApiDescription<IConfigService> = {
  subRoute: '/api/config',
  mapping: {
    getConfig: { method: 'GET', path: '' },
    updateConfig: { method: 'PUT', path: '' },
    getAgentModelKeys: { method: 'GET', path: 'agent-model-keys' },
    getUserConfig: { method: 'GET', path: 'user-config' },
    saveUserConfig: { method: 'PUT', path: 'user-config' },
    testProviderConnection: { method: 'POST', path: 'user-config/providers/:providerRef/test' },
    refreshUserProviderModels: {
      method: 'POST',
      path: 'user-config/providers/:providerRef/models/refresh',
    },
    refreshProviderModels: { method: 'POST', path: 'providers/:providerRef/models/refresh' },
    getEnvStatus: { method: 'GET', path: 'env-status' },
    setEnvVar: { method: 'PUT', path: 'env-key' },
  },
};
