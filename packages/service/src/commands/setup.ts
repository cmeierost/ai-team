/**
 * Setup command — LLM configuration only.
 *
 * Handles provider selection, base URL, model, API key, config save,
 * and connection test. Does NOT create agents or start onboarding.
 *
 * Both CLI and web client can drive this through the question protocol.
 */

import {
  ensureAiTeamDirectory,
  loadTeamConfig,
  resolveEffectiveLlmSettings,
  saveUserConfig,
  saveTeamConfig,
  saveEnvFile,
  testLlmConnection,
  loadEnvFile,
} from '@ai-team/infrastructure';
import type { UserConfig, TeamConfig } from '@ai-team/infrastructure';
import type { SetupOptions } from '@ai-team/api-client';
import { getGitUserName, developerNameToId } from '../utils/git.js';
import { updateWorkspaceSettings } from './init/update-workspace-settings.js';
import { updateGitignore } from './init/update-gitignore.js';
import { askLlmSetup, type LlmSetupResult, type LlmSettingsIo } from './init/llm-settings.js';
import {
  type InitRuntimeHooks,
  requestInput,
  requestConfirm,
  requestSelect,
  requestPassword,
} from './init/workflow-questions.js';

// ── Output helpers ────────────────────────────────────────────────────────────

function writeLine(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'info', message });
  if (!hooks?.emit) {
    process.stdout.write(`${message}\n`);
  }
}

function writeWarn(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'warn', message });
  if (!hooks?.emit) {
    process.stdout.write(`${message}\n`);
  }
}

function writeError(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'error', message });
  if (!hooks?.emit) {
    process.stderr.write(`${message}\n`);
  }
}

function buildLlmSettingsIo(hooks: InitRuntimeHooks | undefined): LlmSettingsIo {
  return {
    select: (request) => requestSelect(hooks, request),
    input: (request) => requestInput(hooks, request),
    password: (request) => requestPassword(hooks, request),
    writeLine: (message) => writeLine(hooks, message),
    writeWarn: (message) => writeWarn(hooks, message),
  };
}

// ── Config builders ───────────────────────────────────────────────────────────

const DEFAULT_SKILL_SOURCES = ['https://github.com/anthropics/skills'];

function inferDefaultProviderRef(setup: LlmSetupResult): string {
  if (setup.provider === 'github-copilot') return 'copilot';
  const baseUrl = setup.baseUrl?.toLowerCase() ?? '';
  if (baseUrl.includes('api.openai.com')) return 'openai';
  if (baseUrl.includes('localhost')) return 'local';
  return 'personal-openai';
}

function buildUserConfigFromSetup(setup: LlmSetupResult): UserConfig {
  const gitDeveloperName = getGitUserName();
  const providerRef = inferDefaultProviderRef(setup);

  const providerEntry =
    setup.provider === 'github-copilot'
      ? {
          kind: 'github-copilot' as const,
          ...(setup.model ? { defaultModel: setup.model } : {}),
          ...(setup.model ? { models: [{ name: setup.model }] } : {}),
        }
      : {
          kind: 'openai-compatible' as const,
          ...(setup.baseUrl ? { baseUrl: setup.baseUrl } : {}),
          ...(setup.model ? { defaultModel: setup.model } : {}),
          ...(setup.model ? { models: [{ name: setup.model }] } : {}),
          ...(setup.apiKey ? { apiKeyEnvVar: 'AI_TEAM_LLM_API_KEY' } : {}),
        };

  return {
    ...(gitDeveloperName
      ? {
          developer: {
            id: developerNameToId(gitDeveloperName),
            name: gitDeveloperName,
          },
        }
      : {}),
    defaultModel: setup.model ? { provider: providerRef, model: setup.model } : undefined,
    providers: {
      [providerRef]: providerEntry,
    },
  };
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function setupCommand(
  workspaceRoot: string,
  options?: SetupOptions,
  hooks?: InitRuntimeHooks
) {
  const existingConfig = await loadTeamConfig(workspaceRoot);

  // Check if already configured
  let reusedExistingLlm = false;
  let llmConfig: LlmSetupResult;
  let existingResolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings> | undefined;

  try {
    if (existingConfig) {
      existingResolvedLlm = resolveEffectiveLlmSettings(existingConfig);
    }
  } catch {
    existingResolvedLlm = undefined;
  }

  if (existingResolvedLlm && !options?.force) {
    const providerLabel =
      existingResolvedLlm.config.provider === 'github-copilot'
        ? 'GitHub Copilot'
        : `OpenAI-compatible (${existingResolvedLlm.config.baseUrl ?? 'custom base URL'})`;

    writeLine(hooks, `LLM already configured: ${providerLabel}`);
    const reconfigure = await requestConfirm(hooks, {
      message: 'Reconfigure LLM connection?',
      default: false,
    });

    if (!reconfigure) {
      writeLine(hooks, 'Keeping existing LLM configuration.');
      return;
    }
  }

  // If force + existing config, offer to reuse
  if (options?.force && existingResolvedLlm) {
    const providerLabel =
      existingResolvedLlm.config.provider === 'github-copilot'
        ? 'GitHub Copilot'
        : `OpenAI-compatible (${existingResolvedLlm.config.baseUrl ?? 'custom base URL'})`;
    const providerRefSuffix = existingResolvedLlm.providerRef
      ? ` [${existingResolvedLlm.providerRef}]`
      : '';

    writeLine(hooks, `  Current LLM: ${providerLabel}${providerRefSuffix}`);
    const reuse = await requestConfirm(hooks, {
      message: 'Reuse existing default LLM connection?',
      default: true,
    });

    if (reuse) {
      if (existingResolvedLlm.config.provider === 'openai-compatible') {
        const envVars = await loadEnvFile(workspaceRoot);
        const keyEnvVar = existingResolvedLlm.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
        const existingKey =
          envVars[keyEnvVar] ||
          envVars['AI_TEAM_LLM_API_KEY'] ||
          envVars['LLM_API_KEY'] ||
          envVars['OPENAI_API_KEY'];
        if (existingKey) {
          llmConfig = { ...existingResolvedLlm.config, apiKey: existingKey };
          reusedExistingLlm = true;
          writeLine(hooks, 'Reusing existing OpenAI-compatible configuration.');
        } else {
          writeWarn(hooks, 'No API key found; re-running setup...');
          llmConfig = await askLlmSetup(buildLlmSettingsIo(hooks));
        }
      } else {
        llmConfig = { ...existingResolvedLlm.config };
        reusedExistingLlm = true;
        writeLine(hooks, 'Reusing existing GitHub Copilot configuration.');
      }
    } else {
      llmConfig = await askLlmSetup(buildLlmSettingsIo(hooks));
    }
  } else {
    llmConfig = await askLlmSetup(buildLlmSettingsIo(hooks));
  }

  // Ensure directory and save config
  await ensureAiTeamDirectory(workspaceRoot);

  const { apiKey, ...safeLlmConfig } = llmConfig;
  const teamConfig: TeamConfig = existingConfig
    ? {
        ...existingConfig,
        llm: safeLlmConfig,
        skillSources: existingConfig.skillSources?.length
          ? existingConfig.skillSources
          : DEFAULT_SKILL_SOURCES,
      }
    : {
        version: '0.1.0',
        randomAvatarUrls: [],
        llm: safeLlmConfig,
        skillSources: DEFAULT_SKILL_SOURCES,
      };
  await saveTeamConfig(workspaceRoot, teamConfig);

  if (apiKey && !reusedExistingLlm) {
    await saveEnvFile(workspaceRoot, { AI_TEAM_LLM_API_KEY: apiKey });
  }

  await saveUserConfig(workspaceRoot, buildUserConfigFromSetup(llmConfig));
  writeLine(hooks, 'Saved LLM configuration.');

  await updateWorkspaceSettings(workspaceRoot);
  await updateGitignore(workspaceRoot);

  // Display config summary
  writeLine(hooks, '');
  writeLine(hooks, 'LLM Configuration:');
  if (llmConfig.provider === 'github-copilot') {
    writeLine(hooks, '  Provider: GitHub Copilot');
    if (llmConfig.model) {
      writeLine(hooks, `  Model:    ${llmConfig.model}`);
    }
  } else {
    writeLine(hooks, '  Provider: OpenAI-compatible');
    writeLine(hooks, `  Base URL: ${llmConfig.baseUrl}`);
    if (llmConfig.model) {
      writeLine(hooks, `  Model:    ${llmConfig.model}`);
    }
    writeLine(hooks, `  API Key:  ${apiKey ? 'saved to .ai-team/.env' : 'not set'}`);
  }

  // Test connection
  writeLine(hooks, '');
  writeLine(hooks, 'Testing LLM connection...');
  try {
    const reply = await testLlmConnection(safeLlmConfig, apiKey);
    writeLine(hooks, 'LLM connection working!');
    writeLine(hooks, `  Response: ${reply}`);
  } catch (testError) {
    writeError(
      hooks,
      `LLM connection failed: ${testError instanceof Error ? testError.message : String(testError)}`
    );
    writeLine(hooks, '  You can retry later with: ait test-connection');
  }
}
