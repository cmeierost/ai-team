/**
 * Onboard command — CEO + HR Director creation, business definition, team hiring.
 *
 * Requires LLM to be configured (via `setup` command first).
 * Creates the founding team, runs the business definition chat with the CEO,
 * then the team planning chat with the HR Director, and finally drops
 * into interactive CEO chat.
 */

import {
  loadTeamConfig,
  resolveEffectiveLlmSettings,
  LlmService,
  loadEnvFile,
} from '@ai-team/infrastructure';
import type { OnboardOptions } from '@ai-team/api-client';
import type { InitRuntimeHooks } from './init/workflow-questions.js';

function writeLine(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'info', message });
  if (!hooks?.emit) {
    process.stdout.write(`${message}\n`);
  }
}

export async function onboardCommand(
  workspaceRoot: string,
  options?: OnboardOptions,
  hooks?: InitRuntimeHooks
) {
  // Verify LLM is configured
  const teamConfig = await loadTeamConfig(workspaceRoot);
  if (!teamConfig) {
    throw new Error('LLM is not configured. Run `ait setup` first to configure your LLM provider.');
  }

  let resolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings>;
  try {
    resolvedLlm = resolveEffectiveLlmSettings(teamConfig);
  } catch {
    throw new Error(
      'LLM configuration is incomplete. Run `ait setup` to reconfigure your provider.'
    );
  }

  // Build LLM service
  let apiKey: string | undefined;
  if (resolvedLlm.apiKeyEnvVar) {
    const envVars = await loadEnvFile(workspaceRoot);
    apiKey = envVars[resolvedLlm.apiKeyEnvVar] || envVars['AI_TEAM_LLM_API_KEY'];
  }

  const llm = new LlmService(workspaceRoot);
  llm.initializeFromConfig(resolvedLlm.config, apiKey);

  writeLine(hooks, '');
  writeLine(hooks, 'Starting team onboarding...');

  // Delegate to the existing onboarding flow in init.ts
  const { runOnboarding } = await import('./init.js');
  await runOnboarding(workspaceRoot, llm, hooks);
}
