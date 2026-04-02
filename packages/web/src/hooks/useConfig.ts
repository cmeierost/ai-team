import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE } from '../context/TeamContext';

export interface LlmProviderConfig {
  kind: string;
  defaultModel?: string;
  models?: Array<{
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }>;
  imageModels?: Record<string, string>;
  baseUrl?: string;
  apiKeyEnvVar?: string;
  contextWindow?: number;
  modelDiscovery?: {
    lastRefreshedAt?: string;
    lastRefreshStatus?: 'ok' | 'error';
    lastRefreshError?: string;
  };
}

/** Clean provider connection info stored in config.user.json */
export interface ProviderConfig {
  kind: string;
  defaultModel?: string;
  models?: Array<{
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }>;
  imageModels?: Record<string, string>;
  params?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    stop?: string[];
  };
  baseUrl?: string;
  apiKeyEnvVar?: string;
  contextWindow?: number;
  modelDiscovery?: {
    lastRefreshedAt?: string;
    lastRefreshStatus?: 'ok' | 'error';
    lastRefreshError?: string;
  };
}

/** Named global model key entry stored in config.json */
export interface ModelKeyEntry {
  provider: string;
  model: string;
  contextWindow?: number;
}

/** Personal user config stored in .ai-team/config.user.json (git-ignored) */
export interface UserConfig {
  version?: string;
  developer?: {
    id?: string;
    name?: string;
    email?: string;
    avatar?: string;
    portfolioUrl?: string;
  };
  providers?: Record<string, ProviderConfig>;
  /** Explicit default provider + model selection */
  defaultModel?: { provider: string; model: string; contextWindow?: number };
  modelKeys?: Record<string, ModelKeyEntry>;
  systemModels?: Record<string, { provider?: string; modelKey?: string; model?: string; contextWindow?: number }>;
}

export interface TeamConfig {
  version: string;
  providers?: Record<string, LlmProviderConfig>;
  /** Explicit default provider + model selection */
  defaultModel?: { provider: string; model: string; contextWindow?: number };
  skillSources?: string[];
  allowedCliTools?: string[];
  /** Global named model key assignments */
  modelKeys?: Record<string, ModelKeyEntry>;
  systemModels?: Record<string, { provider?: string; modelKey?: string; model?: string; contextWindow?: number }>;
  fileTree?: {
    readPaths?: string[];
    writePaths?: string[];
    createPaths?: string[];
    deletePaths?: string[];
  };
  fileTypeGroups?: Record<string, {
    label?: string;
    patterns?: string[];
    /** Backward-compatible field; UI prefers `patterns`. */
    extensions?: string[];
  }>;
}

export const configQueryKeys = {
  config: ['config'] as const,
  agentModelKeys: ['config', 'agent-model-keys'] as const,
  userConfig: ['user-config'] as const,
  envStatus: ['env-status'] as const,
};

async function fetchConfig(): Promise<TeamConfig> {
  const response = await fetch(`${API_BASE}/api/config`);
  if (!response.ok) throw new Error(`Failed to load config: ${response.statusText}`);
  return response.json();
}

async function putConfig(partial: Partial<TeamConfig>): Promise<TeamConfig> {
  const response = await fetch(`${API_BASE}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  if (!response.ok) throw new Error(`Failed to save config: ${response.statusText}`);
  return response.json();
}

async function fetchAgentModelKeys(): Promise<{ usedKeys: string[]; keysByAgent: Record<string, string> }> {
  const response = await fetch(`${API_BASE}/api/config/agent-model-keys`);
  if (!response.ok) throw new Error(`Failed to load agent model keys: ${response.statusText}`);
  return response.json();
}

async function postRefreshProviderModels(providerRef: string): Promise<Array<{
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}>> {
  const response = await fetch(
    `${API_BASE}/api/config/providers/${encodeURIComponent(providerRef)}/models/refresh`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(`Failed to refresh models: ${response.statusText}`);
  return response.json();
}

async function fetchUserConfig(): Promise<UserConfig> {
  const response = await fetch(`${API_BASE}/api/config/user-config`);
  if (!response.ok) throw new Error(`Failed to load user config: ${response.statusText}`);
  return response.json();
}

async function putUserConfig(partial: Partial<UserConfig>): Promise<UserConfig> {
  const response = await fetch(`${API_BASE}/api/config/user-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  if (!response.ok) throw new Error(`Failed to save user config: ${response.statusText}`);
  return response.json();
}

async function postTestProviderConnection(providerRef: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const response = await fetch(
    `${API_BASE}/api/config/user-config/providers/${encodeURIComponent(providerRef)}/test`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(`Failed to test provider: ${response.statusText}`);
  return response.json();
}

async function fetchEnvStatus(): Promise<Record<string, boolean>> {
  const response = await fetch(`${API_BASE}/api/config/env-status`);
  if (!response.ok) throw new Error(`Failed to load env status: ${response.statusText}`);
  return response.json();
}

async function putEnvVar(args: { key: string; value: string }): Promise<void> {
  const response = await fetch(`${API_BASE}/api/config/env-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`Failed to set env var: ${response.statusText}`);
}

async function postRefreshDevProviderModels(providerRef: string): Promise<{ models: Array<{
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}> }> {
  const response = await fetch(
    `${API_BASE}/api/config/user-config/providers/${encodeURIComponent(providerRef)}/models/refresh`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(`Failed to refresh developer provider models: ${response.statusText}`);
  return response.json();
}

export function useConfig() {
  return useQuery({
    queryKey: configQueryKeys.config,
    queryFn: fetchConfig,
  });
}

export function useSaveConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(configQueryKeys.config, data);
    },
  });
}

export function useAgentModelKeys() {
  return useQuery({
    queryKey: configQueryKeys.agentModelKeys,
    queryFn: fetchAgentModelKeys,
  });
}

export function useRefreshProviderModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postRefreshProviderModels,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configQueryKeys.config });
    },
  });
}

export function useUserConfig() {
  return useQuery({
    queryKey: configQueryKeys.userConfig,
    queryFn: fetchUserConfig,
  });
}

export function useSaveUserConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putUserConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(configQueryKeys.userConfig, data);
    },
  });
}

export function useTestProviderConnection() {
  return useMutation({
    mutationFn: postTestProviderConnection,
  });
}

export function useEnvStatus() {
  return useQuery({
    queryKey: configQueryKeys.envStatus,
    queryFn: fetchEnvStatus,
  });
}

export function useSetEnvVar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putEnvVar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configQueryKeys.envStatus });
    },
  });
}

export function useRefreshDevProviderModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postRefreshDevProviderModels,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configQueryKeys.userConfig });
    },
  });
}

