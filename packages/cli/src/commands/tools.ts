import chalk from 'chalk';
import type { AiTeamClient, ListToolsResponse } from '@ai-team/api-client';

interface ToolsListOptions {
  agent?: string;
  json?: boolean;
}

interface ToolsMutationOptions {
  agent?: string;
  tool?: string;
  json?: boolean;
}

function ensureRequiredOption(value: string | undefined, flag: '--agent' | '--tool'): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required option ${flag}`);
  }
  return value;
}

function printToolList(response: ListToolsResponse): void {
  if (response.entries.length === 0) {
    console.log(chalk.yellow('No tools registered.'));
    return;
  }

  if (response.agent) {
    console.log(chalk.bold(`\nTools for ${chalk.cyan(response.agent.name)} ${chalk.dim(`(${response.agent.id})`)}`));
    console.log(chalk.dim(`Role: ${response.agent.role}`));
  } else {
    console.log(chalk.bold('\nAll Registered Tools'));
  }

  for (const entry of response.entries) {
    const allowedBadge = typeof entry.allowedForAgent === 'boolean'
      ? entry.allowedForAgent
        ? chalk.green(' [allowed]')
        : chalk.red(' [denied]')
      : '';

    console.log(`\n${chalk.cyan(entry.name)}${allowedBadge}`);
    console.log(chalk.dim(`  ${entry.description}`));

    if (entry.tags && entry.tags.length > 0) {
      console.log(chalk.dim(`  tags: ${entry.tags.join(', ')}`));
    }

    if (entry.deniedReason) {
      console.log(chalk.red(`  reason: ${entry.deniedReason}`));
    }
  }

  console.log(chalk.dim(`\n${response.entries.length} tool${response.entries.length === 1 ? '' : 's'}\n`));
}

export async function toolsCommand(client: AiTeamClient, options: ToolsListOptions = {}): Promise<void> {
  const response = await client.listTools({ agent: options.agent });

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  printToolList(response);
}

export async function toolsAllowCommand(client: AiTeamClient, options: ToolsMutationOptions = {}): Promise<void> {
  const agent = ensureRequiredOption(options.agent, '--agent');
  const tool = ensureRequiredOption(options.tool, '--tool');
  const result = await client.allowTool({ agent, tool });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.changed) {
    console.log(chalk.green(`✔ Allowed tool ${chalk.cyan(result.tool)} for ${chalk.cyan(result.agent.name)} (${result.agent.id})`));
  } else {
    console.log(chalk.yellow(`Tool ${chalk.cyan(result.tool)} was already allowed for ${chalk.cyan(result.agent.name)} (${result.agent.id})`));
  }

  console.log(chalk.dim(`tools: ${result.tools.join(', ') || '(none)'}`));
}

export async function toolsDisallowCommand(client: AiTeamClient, options: ToolsMutationOptions = {}): Promise<void> {
  const agent = ensureRequiredOption(options.agent, '--agent');
  const tool = ensureRequiredOption(options.tool, '--tool');
  const result = await client.disallowTool({ agent, tool });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.changed) {
    console.log(chalk.green(`✔ Disallowed tool ${chalk.cyan(result.tool)} for ${chalk.cyan(result.agent.name)} (${result.agent.id})`));
  } else {
    console.log(chalk.yellow(`Tool ${chalk.cyan(result.tool)} was already disallowed for ${chalk.cyan(result.agent.name)} (${result.agent.id})`));
  }

  console.log(chalk.dim(`tools: ${result.tools.join(', ') || '(none)'}`));
}
