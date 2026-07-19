import chalk from 'chalk';
import type { ListToolsResponse, UpdateAgentToolResponse } from '@ai-team/api-contracts';
import type { ICliCommandClient } from '../cli-command-client.js';
import { runCommandStream } from './stream-runner.js';

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
    console.log(
      chalk.bold(
        `\nTools for ${chalk.cyan(response.agent.name)} ${chalk.dim(`(${response.agent.id})`)}`
      )
    );
    console.log(chalk.dim(`Role: ${response.agent.role}`));
  } else {
    console.log(chalk.bold('\nAll Registered Tools'));
  }

  const grouped = new Map<string, typeof response.entries>();
  for (const entry of response.entries) {
    const key = entry.group ?? 'other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }

  const sortedGroups = [...grouped.keys()].sort((a, b) => {
    if (a === 'other') return 1;
    if (b === 'other') return -1;
    return a.localeCompare(b);
  });

  for (const group of sortedGroups) {
    console.log(chalk.bold(`\n  ${group}`));
    for (const entry of grouped.get(group)!) {
      const allowedBadge =
        typeof entry.allowedForAgent === 'boolean'
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

  console.log(
    chalk.dim(`\n${response.entries.length} tool${response.entries.length === 1 ? '' : 's'}\n`)
  );
}

function printToolMutationResult(
  result: UpdateAgentToolResponse,
  verb: 'Allowed' | 'Disallowed',
  json?: boolean
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.changed) {
    console.log(
      chalk.green(
        `✔ ${verb} tool ${chalk.cyan(result.tool)} for ${chalk.cyan(result.agent.name)} (${result.agent.id})`
      )
    );
  } else {
    console.log(
      chalk.yellow(
        `Tool ${chalk.cyan(result.tool)} was already ${verb.toLowerCase()} for ${chalk.cyan(result.agent.name)} (${result.agent.id})`
      )
    );
  }

  console.log(chalk.dim(`tools: ${result.tools.join(', ') || '(none)'}`));
}

export function renderToolsList(response: ListToolsResponse, options: ToolsListOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  printToolList(response);
}

export async function renderToolsAllow(
  commandClient: ICliCommandClient,
  options: ToolsMutationOptions = {}
): Promise<void> {
  const agent = ensureRequiredOption(options.agent, '--agent');
  const tool = ensureRequiredOption(options.tool, '--tool');

  await runCommandStream(
    commandClient,
    {
      command: 'toolsAllow',
      payload: {
        agent,
        tool,
        requestedBy: options.requestedBy,
        approvedByUser: options.approvedByUser,
      },
    },
    {
      resultHandler: (data) =>
        printToolMutationResult(data as UpdateAgentToolResponse, 'Allowed', options.json),
    }
  );
}

export async function renderToolsDeny(
  commandClient: ICliCommandClient,
  options: ToolsMutationOptions = {}
): Promise<void> {
  const agent = ensureRequiredOption(options.agent, '--agent');
  const tool = ensureRequiredOption(options.tool, '--tool');

  await runCommandStream(
    commandClient,
    {
      command: 'toolsDeny',
      payload: {
        agent,
        tool,
        requestedBy: options.requestedBy,
        approvedByUser: options.approvedByUser,
      },
    },
    {
      resultHandler: (data) =>
        printToolMutationResult(data as UpdateAgentToolResponse, 'Disallowed', options.json),
    }
  );
}
