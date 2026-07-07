/**
 * System status query — lightweight check of initialization state.
 *
 * Returns whether the workspace has been initialized, has LLM config,
 * and has any agents created.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ICommand, TeamConfig, ICommandDescriptor } from '@ai-team/core';
import type { SystemStatus } from '@ai-team/api-contracts';
import { resolveEffectiveLlmSettings } from '@ai-team/core';

export class SystemStatusCommand {
  constructor(private readonly teamConfig: TeamConfig) {}

  async executeAsync(workspaceRoot: string): Promise<SystemStatus> {
    return getSystemStatusAsync(workspaceRoot, this.teamConfig);
  }
}

type Params = z.infer<typeof SystemStatusICommand.schema>;
const _systemStatusICommandSchema = z.object({});

export const SystemStatusICommandMetadata = {
  key: 'system-status',
  description: 'Check system initialization status',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'system',
  parameters: _systemStatusICommandSchema,
} satisfies ICommandDescriptor;

export class SystemStatusICommand implements ICommand<Params, SystemStatus> {
  static readonly schema = _systemStatusICommandSchema;
  readonly metadata = SystemStatusICommandMetadata;

  constructor(private readonly teamConfig: TeamConfig) {}

  async execute(_payload: Params, _unusedOrCtx?: unknown, ctx?: any): Promise<any> {
    const workspaceRoot = (ctx ?? (_unusedOrCtx as any))?.workspaceRoot ?? '';
    return getSystemStatusAsync(workspaceRoot, this.teamConfig);
  }
}

async function getSystemStatusAsync(
  workspaceRoot: string,
  teamConfig: TeamConfig
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
      resolveEffectiveLlmSettings(teamConfig);
      hasLlmConfig = true;
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
