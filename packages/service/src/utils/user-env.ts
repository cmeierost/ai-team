import { getGitUserName } from './git.js';
import { ServiceDomainError } from '../errors.js';
import type { IEnvironmentStorage } from '@ai-team/core';

export interface UserEnvRequirements {
  developerName?: boolean;
  apiKey?: boolean;
}

interface EnsureOptions {
  force?: boolean;
  quiet?: boolean;
  apiKeyEnvVar?: string;
  preset?: Partial<Record<string, string>>;
}

export class MissingUserInputError extends ServiceDomainError {
  constructor(
    public readonly envVar: string,
    message: string
  ) {
    super(
      'INPUT_REQUIRED',
      message,
      { envVar },
      {
        kind: 'env-var',
        key: envVar,
        prompt:
          envVar === 'AI_TEAM_USER_NAME'
            ? 'Enter your name (shared with agents):'
            : `Enter API key for ${envVar}:`,
      }
    );
    this.name = 'MissingUserInputError';
  }
}

export async function ensureUserEnvVars(
  workspaceRoot: string,
  requirements: UserEnvRequirements,
  options: EnsureOptions = {},
  environmentStorage: IEnvironmentStorage
): Promise<Record<string, string>> {
  const envVars = await environmentStorage.loadEnvFileAsync(workspaceRoot);
  const updates = { ...envVars };
  let dirty = false;

  if (requirements.developerName && (options.force || !updates.AI_TEAM_USER_NAME)) {
    const developerName =
      options.preset?.AI_TEAM_USER_NAME?.trim() ||
      updates.AI_TEAM_USER_NAME?.trim() ||
      getGitUserName();
    if (!developerName) {
      throw new MissingUserInputError(
        'AI_TEAM_USER_NAME',
        'Missing developer name. Set AI_TEAM_USER_NAME in .ai-team/.env or provide it from the client.'
      );
    }
    const trimmed = developerName.trim();
    if (trimmed !== updates.AI_TEAM_USER_NAME) {
      updates.AI_TEAM_USER_NAME = trimmed;
      dirty = true;
    }
  }

  const preferredApiKeyEnvVar = options.apiKeyEnvVar?.trim() || 'AI_TEAM_LLM_API_KEY';

  if (requirements.apiKey && (options.force || !updates[preferredApiKeyEnvVar])) {
    const apiKeyLookupOrder = Array.from(
      new Set([preferredApiKeyEnvVar, 'AI_TEAM_LLM_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'])
    );

    const apiKey =
      options.preset?.[preferredApiKeyEnvVar]?.trim() ||
      options.preset?.AI_TEAM_LLM_API_KEY?.trim() ||
      apiKeyLookupOrder
        .map((envVar) => updates[envVar]?.trim())
        .find((value): value is string => typeof value === 'string' && value.length > 0);

    if (!apiKey) {
      throw new MissingUserInputError(
        preferredApiKeyEnvVar,
        `Missing API key. Set ${preferredApiKeyEnvVar} in .ai-team/.env or provide it from the client.`
      );
    }

    const trimmed = apiKey.trim();
    if (trimmed !== updates[preferredApiKeyEnvVar]) {
      updates[preferredApiKeyEnvVar] = trimmed;
      dirty = true;
    }
  }

  if (dirty) {
    await environmentStorage.saveEnvFileAsync(workspaceRoot, updates);
  }

  return updates;
}
