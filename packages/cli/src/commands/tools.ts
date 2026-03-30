import chalk from 'chalk';
import { confirm, input } from '@inquirer/prompts';
import type { AiTeamClient, ListToolsResponse } from '@ai-team/api-client';

interface ToolsListOptions {
  agent?: string;
  json?: boolean;
}

interface ToolsMutationOptions {
  agent?: string;
  tool?: string;
  requestedBy?: string;
  approvedByUser?: boolean;
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

  // Group entries by tool.group (fallback 'other')
  const grouped = new Map<string, typeof response.entries>();
  for (const entry of response.entries) {
    const key = (entry as any).group ?? 'other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }

  // Sort groups alphabetically, 'other' last
  const sortedGroups = [...grouped.keys()].sort((a, b) => {
    if (a === 'other') return 1;
    if (b === 'other') return -1;
    return a.localeCompare(b);
  });

  for (const group of sortedGroups) {
    console.log(chalk.bold(`\n  ${group}`));
    for (const entry of grouped.get(group)!) {
      const allowedBadge = typeof entry.allowedForAgent === 'boolean'
        ? entry.allowedForAgent
          ? chalk.green(' [allowed]')
          : chalk.red(' [denied]')
        : '';

      console.log(`    ${chalk.cyan(entry.name)}${allowedBadge}`);
      console.log(chalk.dim(`      ${entry.description}`));

      if (entry.tags && entry.tags.length > 0) {
        console.log(chalk.dim(`      tags: ${entry.tags.join(', ')}`));
      }

      if (entry.deniedReason) {
        console.log(chalk.red(`      reason: ${entry.deniedReason}`));
      }
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

  const requestedBy = options.requestedBy?.trim() || await input({
    message: 'Requested by (must be CEO/HR):',
    validate: (value) => value.trim().length > 0 || 'requestedBy is required',
  });

  const approvedByUser = typeof options.approvedByUser === 'boolean'
    ? options.approvedByUser
    : await confirm({
      message: `Approve tool_allow by ${requestedBy} for agent '${agent}' and tool '${tool}'?`,
      default: false,
    });

  const governedClient = client as AiTeamClient & {
    toolAllow?: (
      payload: { agent: string; tool: string },
      governance: { requestedBy: string; approvedByUser: boolean },
    ) => Promise<Awaited<ReturnType<AiTeamClient['allowTool']>>>;
  };

  const result = governedClient.toolAllow
    ? await governedClient.toolAllow({ agent, tool }, { requestedBy, approvedByUser })
    : await client.allowTool({ agent, tool });

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

  const requestedBy = options.requestedBy?.trim() || await input({
    message: 'Requested by (must be CEO/HR):',
    validate: (value) => value.trim().length > 0 || 'requestedBy is required',
  });

  const approvedByUser = typeof options.approvedByUser === 'boolean'
    ? options.approvedByUser
    : await confirm({
      message: `Approve tool_deny by ${requestedBy} for agent '${agent}' and tool '${tool}'?`,
      default: false,
    });

  const governedClient = client as AiTeamClient & {
    toolDeny?: (
      payload: { agent: string; tool: string },
      governance: { requestedBy: string; approvedByUser: boolean },
    ) => Promise<Awaited<ReturnType<AiTeamClient['disallowTool']>>>;
  };

  const result = governedClient.toolDeny
    ? await governedClient.toolDeny({ agent, tool }, { requestedBy, approvedByUser })
    : await client.disallowTool({ agent, tool });

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
