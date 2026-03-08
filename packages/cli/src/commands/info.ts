/**
 * Info command - display an agent's full profile / portfolio
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { resolve } from 'path';
import chalk from 'chalk';
import type { AiTeamClient } from '@ai-team/api-client';
import { Agent } from '@ai-team/core';

const execAsync = promisify(exec);

interface InfoOptions {
  json?: boolean;
  openAvatar?: boolean;
}

export async function infoCommand(client: AiTeamClient, agentId: string, options: InfoOptions) {
  const matches = await client.resolveEmployees(agentId);

  if (matches.length === 0) {
    console.log(chalk.red(`No agent found matching "${agentId}".`));
    process.exit(1);
  }

  if (matches.length > 1) {
    console.log(chalk.yellow(`Multiple agents match "${agentId}":`));
    for (const m of matches) {
      console.log(chalk.dim(`  - ${m.name} (${m.role}) [${m.id}]`));
    }
    console.log(chalk.yellow('Please be more specific.'));
    process.exit(1);
  }

  const agent = matches[0];

  if (options.json) {
    console.log(JSON.stringify(agent, null, 2));
    return;
  }

  // Show command - only open avatar
  if (options.openAvatar) {
    if (agent.avatar?.type === 'url' && agent.avatar.url) {
      const avatarPath = resolve(process.cwd(), agent.avatar.url);
      await openInDefaultViewer(avatarPath);
    } else {
      console.log(chalk.yellow('No avatar configured'));
    }
    return;
  }

  // Info command - display full profile
  printAgentInfo(agent);
}

function printAgentInfo(agent: Agent) {
  console.log(chalk.bold(`\n  ${agent.name} (${agent.role})\n`));

  console.log(chalk.dim('  ID:           ') + agent.id);
  console.log(chalk.dim('  Role:         ') + agent.role);
  console.log(chalk.dim('  Type:         ') + (agent.type || 'n/a'));
  console.log(chalk.dim('  Context:      ') + (agent.contextLevel || 'n/a'));
  if (agent.reportsTo) {
    console.log(chalk.dim('  Reports to:   ') + agent.reportsTo);
  }
  if (agent.specializations && agent.specializations.length > 0) {
    console.log(chalk.dim('  Specializations: ') + agent.specializations.join(', '));
  }
  if (agent.personality) {
    const p = agent.personality;
    if (p.communication_style) console.log(chalk.dim('  Style:        ') + p.communication_style);
    if (p.expertise_level) console.log(chalk.dim('  Expertise:    ') + p.expertise_level);
  }
  
  // Display avatar if configured
  if (agent.avatar?.type === 'url' && agent.avatar.url) {
    console.log(chalk.dim('  Avatar:       ') + agent.avatar.url);
  }
  
  if (agent.llm) {
    if (agent.llm.provider) console.log(chalk.dim('  LLM Provider: ') + agent.llm.provider);
    if (agent.llm.modelKey) console.log(chalk.dim('  LLM ModelKey: ') + agent.llm.modelKey);
    if (agent.llm.model) console.log(chalk.dim('  LLM Model:    ') + agent.llm.model);
    if (agent.llm.baseUrl) console.log(chalk.dim('  LLM Base URL: ') + agent.llm.baseUrl);
    if (agent.llm.params) {
      const params = Object.entries(agent.llm.params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('|') : value}`)
        .join(', ');
      if (params) {
        console.log(chalk.dim('  LLM Params:   ') + params);
      }
    }
  }
  if (agent.createdAt) {
    console.log(chalk.dim('  Created:      ') + new Date(agent.createdAt).toLocaleDateString());
  }
  if (agent.lastInteraction) {
    console.log(chalk.dim('  Last active:  ') + new Date(agent.lastInteraction).toLocaleDateString());
  }
  if (agent.conversationCount) {
    console.log(chalk.dim('  Messages:     ') + agent.conversationCount);
  }

  if (agent.markdown?.trim()) {
    console.log(chalk.dim('\n  ─── Bio ───'));
    for (const line of agent.markdown.trim().split('\n')) {
      console.log('  ' + line);
    }
  }

  console.log(chalk.dim(`\n  File: ${agent.filePath}`));
  console.log();
}

async function openInDefaultViewer(filePath: string): Promise<void> {
  const os = platform();
  let command: string;

  switch (os) {
    case 'win32':
      command = `start "" "${filePath}"`;
      break;
    case 'darwin':
      command = `open "${filePath}"`;
      break;
    default: // linux and others
      command = `xdg-open "${filePath}"`;
      break;
  }

  try {
    await execAsync(command);
  } catch (_error) {
    console.warn(chalk.yellow(`\nCould not open avatar automatically. Please open manually:\n${filePath}\n`));
  }
}
