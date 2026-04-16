/**
 * System status query — lightweight check of initialization state.
 *
 * Returns whether the workspace has been initialized, has LLM config,
 * and has any agents created.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTeamConfig, resolveEffectiveLlmSettings } from '@ai-team/infrastructure';
import type { SystemStatus } from '@ai-team/api-client';

export async function getSystemStatusAsync(workspaceRoot: string): Promise<SystemStatus> {
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');

  // Check if .ai-team directory exists
  let initialized = false;
  try {
    const stats = await fs.stat(aiTeamDir);
    initialized = stats.isDirectory();
  } catch {
    initialized = false;
  }

  // Check LLM configuration
  let hasLlmConfig = false;
  if (initialized) {
    try {
      const teamConfig = await loadTeamConfig(workspaceRoot);
      if (teamConfig) {
        resolveEffectiveLlmSettings(teamConfig);
        hasLlmConfig = true;
      }
    } catch {
      hasLlmConfig = false;
    }
  }

  // Check if any agents exist
  let hasAgents = false;
  if (initialized) {
    const agentsDir = path.join(aiTeamDir, 'agents');
    try {
      const entries = await fs.readdir(agentsDir);
      hasAgents = entries.some((e) => e.endsWith('.agent.md'));
    } catch {
      hasAgents = false;
    }
  }

  return { initialized, hasLlmConfig, hasAgents };
}
