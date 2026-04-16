import { loadEnvFile, saveEnvFile } from '@ai-team/infrastructure';
import { getGitUserName } from './git.js';
import { ServiceDomainError } from '../errors.js';

export interface UserEnvRequirements {
  developerName?: boolean;
  apiKey?: boolean;
}

interface EnsureOptions {
  force?: boolean;
  quiet?: boolean;
  preset?: Partial<Record<'AI_TEAM_USER_NAME' | 'AI_TEAM_LLM_API_KEY', string>>;
}

export class MissingUserInputError extends ServiceDomainError {
  constructor(
    public readonly envVar: 'AI_TEAM_USER_NAME' | 'AI_TEAM_LLM_API_KEY',
    message: string,
  ) {
    super(
      'INPUT_REQUIRED',
      message,
      { envVar },
      {
        kind: 'env-var',
        key: envVar,
        prompt: envVar === 'AI_TEAM_USER_NAME'
          ? 'Enter your name (shared with agents):'
          : 'Enter your OpenAI-compatible API key:',
      },
    );
    this.name = 'MissingUserInputError';
  }
}

export async function ensureUserEnvVars(
  workspaceRoot: string,
  requirements: UserEnvRequirements,
  options: EnsureOptions = {},
): Promise<Record<string, string>> {
  const envVars = await loadEnvFile(workspaceRoot);
  const updates = { ...envVars };
  let dirty = false;

  if (requirements.developerName && (options.force || !updates.AI_TEAM_USER_NAME)) {
    const developerName =
      options.preset?.AI_TEAM_USER_NAME?.trim()
      || updates.AI_TEAM_USER_NAME?.trim()
      || getGitUserName();
    if (!developerName) {
      throw new MissingUserInputError(
        'AI_TEAM_USER_NAME',
        'Missing developer name. Set AI_TEAM_USER_NAME in .ai-team/.env or provide it from the client.',
      );
    }
    const trimmed = developerName.trim();
    if (trimmed !== updates.AI_TEAM_USER_NAME) {
      updates.AI_TEAM_USER_NAME = trimmed;
      dirty = true;
    }
  }

  if (requirements.apiKey && (options.force || !updates.AI_TEAM_LLM_API_KEY)) {
    const apiKey =
      options.preset?.AI_TEAM_LLM_API_KEY?.trim()
      || updates.AI_TEAM_LLM_API_KEY?.trim();
    if (!apiKey) {
      throw new MissingUserInputError(
        'AI_TEAM_LLM_API_KEY',
        'Missing API key. Set AI_TEAM_LLM_API_KEY in .ai-team/.env or provide it from the client.',
      );
    }
    const trimmed = apiKey.trim();
    if (trimmed !== updates.AI_TEAM_LLM_API_KEY) {
      updates.AI_TEAM_LLM_API_KEY = trimmed;
      dirty = true;
    }
  }

  if (dirty) {
    await saveEnvFile(workspaceRoot, updates);
  }

  return updates;
}
