/**
 * LLM settings contracts.
 *
 * Runtime resolution lives outside core. Core keeps only portable contracts.
 */

import type {
  Agent,
  LlmConfig,
  Skill,
  TeamConfig,
} from '../types/index.js';
import type { LlmChatOptions } from './index.js';

export interface ResolvedLlmSettings {
  config: LlmConfig;
  options: LlmChatOptions;
  providerRef?: string;
  contextWindow?: number;
}

export interface ILlmSettingsResolver {
  getEffectiveContextWindow(
    providerConfig:
      | {
          contextWindow?: number;
          models?: Array<{ name: string; contextWindow?: number }>;
        }
      | undefined,
    modelKey?: string
  ): number | undefined;

  resolveEffectiveLlmSettings(
    teamConfig: TeamConfig,
    agent?: Pick<Agent, 'llm'>,
    skill?: Pick<Skill, 'llm'>,
    runtimeOverrides?: LlmChatOptions
  ): ResolvedLlmSettings;

  resolveSystemLlmSettings(teamConfig: TeamConfig, purposeKey: string): ResolvedLlmSettings;
}
