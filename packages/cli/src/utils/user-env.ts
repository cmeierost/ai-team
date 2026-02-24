import chalk from 'chalk';
import { input, password } from '@inquirer/prompts';
import { loadEnvFile, saveEnvFile } from '@ai-team/core';
import { getGitUserName } from './git.js';

export interface UserEnvRequirements {
  developerName?: boolean;
  apiKey?: boolean;
}

interface EnsureOptions {
  /** Force re-entry even if values already exist */
  force?: boolean;
  /** Silence informational logs */
  quiet?: boolean;
  /** Pre-populated values that should be written without prompting */
  preset?: Partial<Record<'AI_TEAM_USER_NAME' | 'AI_TEAM_LLM_API_KEY', string>>;
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
    let developerName = options.preset?.AI_TEAM_USER_NAME?.trim() || updates.AI_TEAM_USER_NAME?.trim() || getGitUserName();
    if (!developerName) {
      developerName = await input({
        message: 'Enter your name (shared with agents):',
        validate: value => value.trim().length > 0 || 'Name cannot be empty',
      });
    } else if (!options.quiet) {
      console.log(chalk.dim(`Using developer name: ${developerName}`));
    }
    const trimmed = developerName.trim();
    if (trimmed !== updates.AI_TEAM_USER_NAME) {
      updates.AI_TEAM_USER_NAME = trimmed;
      dirty = true;
    }
  }

  if (requirements.apiKey && (options.force || !updates.AI_TEAM_LLM_API_KEY)) {
    let apiKey = options.preset?.AI_TEAM_LLM_API_KEY?.trim() || updates.AI_TEAM_LLM_API_KEY?.trim();
    if (!apiKey) {
      apiKey = await password({
        message: 'Enter your OpenAI-compatible API key:',
        mask: '*',
        validate: value => value.trim().length > 0 || 'API key is required',
      });
    }
    const trimmed = apiKey.trim();
    if (trimmed !== updates.AI_TEAM_LLM_API_KEY) {
      updates.AI_TEAM_LLM_API_KEY = trimmed;
      dirty = true;
    }
  }

  if (dirty) {
    await saveEnvFile(workspaceRoot, updates);
    if (!options.quiet) {
      console.log(chalk.green('Updated .ai-team/.env with user-specific settings.'));
    }
  }

  return updates;
}
