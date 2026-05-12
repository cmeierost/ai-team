/**
 * System status query — lightweight check of initialization state.
 *
 * Returns whether the workspace has been initialized, has LLM config,
 * and has any agents created.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  IConfigurationStorage,
  CommandResponse,
} from '@ai-team/core';
import type { SystemStatus } from '@ai-team/api-contracts';
import { resolveEffectiveLlmSettings } from '@ai-team/core';

export class SystemStatusCommand {
  constructor(private readonly configurationStorage: IConfigurationStorage) {}

  async executeAsync(workspaceRoot: string): Promise<SystemStatus> {
    return getSystemStatusAsync(workspaceRoot, this.configurationStorage);
  }
}

type Params = z.infer<typeof SystemStatusICommand.schema>;

export class SystemStatusICommand implements ICommand<Params, SystemStatus> {
  static readonly schema = z.object({});

  readonly key = 'system-status';
  readonly cli = { command: 'status', parentKey: 'system' };
  readonly description = 'Check system initialization status';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'system';
  readonly parameters = SystemStatusICommand.schema;

  constructor(private readonly configurationStorage: IConfigurationStorage) {}

  async execute(_payload: Params, ctx: ExecutionContext): Promise<CommandResponse<SystemStatus>> {
    const data = await getSystemStatusAsync(ctx.workspaceRoot, this.configurationStorage);
    return { status: 'ok', data };
  }
}

async function getSystemStatusAsync(
  workspaceRoot: string,
  configurationStorage: IConfigurationStorage
): Promise<SystemStatus> {
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');

  let initialized = false;
  try {
    const stats = await fs.stat(aiTeamDir);
    initialized = stats.isDirectory();
  } catch {
    initialized = false;
  }

  let hasLlmConfig = false;
  if (initialized) {
    try {
      const teamConfig = await configurationStorage.loadTeamConfigAsync(workspaceRoot);
      if (teamConfig) {
        resolveEffectiveLlmSettings(teamConfig);
        hasLlmConfig = true;
      }
    } catch {
      hasLlmConfig = false;
    }
  }

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
