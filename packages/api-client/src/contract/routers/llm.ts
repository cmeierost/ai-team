import { LlmConfig, LlmProviderConfig } from './config';

export interface TestConnectionOptions {
  provider?: string;
  modelKey?: string;
  model?: string;
  all?: boolean;
  employee?: string;
  toolCall?: boolean;
}

export interface ConfigureProviderOptions {
  fromInit?: boolean;
  keepCurrentDefault?: boolean;
  setup?: ProviderSetupInput;
}

export interface SetProviderOptions {
  fromInit?: boolean;
  keepCurrentDefault?: boolean;
  setup?: ProviderSetupInput;
}

export interface AddProviderOptions {
  makeDefault?: boolean;
  setup?: ProviderSetupInput;
}

export interface ProviderSetupInput {
  providerRef: string;
  providerConfig: LlmProviderConfig;
  legacyLlm: LlmConfig;
  apiKeyEnvVar?: string;
  apiKey?: string;
}

export interface ProviderModelsOptions {
  provider?: string;
  json?: boolean;
}

export interface RefreshProviderModelsOptions {
  provider?: string;
}

export interface ProviderListOptions {
  json?: boolean;
}

export interface ILlmService {
  providerConfigure(options?: ConfigureProviderOptions): Promise<void>;
  providerAdd(options?: AddProviderOptions): Promise<void>;
  providerSet(options?: SetProviderOptions): Promise<void>;
  providerList(options?: ProviderListOptions): Promise<void>;
  providerModels(options: ProviderModelsOptions): Promise<void>;
  providerModelsRefresh(options: RefreshProviderModelsOptions): Promise<void>;
  testConnection(options?: TestConnectionOptions): Promise<void>;
}
