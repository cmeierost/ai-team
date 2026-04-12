import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';

export interface LlmProviderConfig {
  kind: 'github-copilot' | 'openai-compatible';
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
  kind: 'github-copilot' | 'openai-compatible';
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
  systemModels?: Record<
    string,
    { provider?: string; modelKey?: string; model?: string; contextWindow?: number }
  >;
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
  systemModels?: Record<
    string,
    { provider?: string; modelKey?: string; model?: string; contextWindow?: number }
  >;
  fileTree?: {
    readPaths?: string[];
    writePaths?: string[];
  };
  fileTypeGroups?: Record<
    string,
    {
      label?: string;
      patterns?: string[];
      /** Backward-compatible field; UI prefers `patterns`. */
      extensions?: string[];
    }
  >;
}

export const configQueryKeys = {
  config: ['config'] as const,
  agentModelKeys: ['config', 'agent-model-keys'] as const,
  userConfig: ['user-config'] as const,
  envStatus: ['env-status'] as const,
};

export function useConfig() {
  const { client } = useTeam();
  return useQuery({
    queryKey: configQueryKeys.config,
    queryFn: () => client.config.getConfig() as Promise<TeamConfig>,
  });
}

export function useSaveConfig() {
  const { client } = useTeam();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (partial: Partial<TeamConfig>) =>
      client.config.updateConfig(partial) as Promise<TeamConfig>,
    onSuccess: (data) => {
      queryClient.setQueryData(configQueryKeys.config, data);
    },
  });
}

export function useAgentModelKeys() {
  const { client } = useTeam();
  return useQuery({
    queryKey: configQueryKeys.agentModelKeys,
    queryFn: () =>
      client.config.getAgentModelKeys() as Promise<{
        usedKeys: string[];
        keysByAgent: Record<string, string>;
      }>,
  });
}

export function useRefreshProviderModels() {
  const { client } = useTeam();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerRef: string) => client.config.refreshProviderModels(providerRef),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configQueryKeys.config });
    },
  });
}

export function useUserConfig() {
  const { client } = useTeam();
  return useQuery({
    queryKey: configQueryKeys.userConfig,
    queryFn: () => client.config.getUserConfig() as Promise<UserConfig>,
  });
}

export function useSaveUserConfig() {
  const { client } = useTeam();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (partial: Partial<UserConfig>) =>
      client.config.saveUserConfig(partial) as Promise<UserConfig>,
    onSuccess: (data) => {
      queryClient.setQueryData(configQueryKeys.userConfig, data);
    },
  });
}

export function useTestProviderConnection() {
  const { client } = useTeam();
  return useMutation({
    mutationFn: (providerRef: string) => client.config.testProviderConnection(providerRef),
  });
}

export function useEnvStatus() {
  const { client } = useTeam();
  return useQuery({
    queryKey: configQueryKeys.envStatus,
    queryFn: () => client.config.getEnvStatus() as Promise<Record<string, boolean>>,
  });
}

export function useSetEnvVar() {
  const { client } = useTeam();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      client.config.setEnvVar({ key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configQueryKeys.envStatus });
    },
  });
}

export function useRefreshDevProviderModels() {
  const { client } = useTeam();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerRef: string) => client.config.refreshUserProviderModels(providerRef),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configQueryKeys.userConfig });
    },
  });
}
