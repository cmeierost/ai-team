import chalk from 'chalk';
import type { FilePermission, AiTeamClient } from '@ai-team/api-client';

interface AccessWhoOptions {
  path?: string;
  right?: FilePermission;
  json?: boolean;
}

interface AccessCanOptions {
  path?: string;
  right?: FilePermission;
  agent?: string;
  json?: boolean;
}

function ensurePath(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error('Missing required option --path');
  }
  return value;
}

export async function accessWhoCommand(client: AiTeamClient, options: AccessWhoOptions = {}): Promise<void> {
  const path = ensurePath(options.path);
  const right = options.right ?? 'list';
  const response = await client.whoHasPermission({ path, right });

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  console.log(chalk.bold(`\nAccess candidates for ${chalk.cyan(response.path.relative || response.path.input)} (${right})`));
  if (response.contexts.length === 0) {
    console.log(chalk.yellow('No contexts can access this path/right.'));
    console.log(chalk.dim(response.explanation));
    console.log();
    return;
  }

  for (const context of response.contexts) {
    console.log(`- ${chalk.cyan(context.contextId)}${context.label ? chalk.dim(` (${context.label})`) : ''}`);
  }
  console.log(chalk.dim(`\n${response.explanation}\n`));
}

export async function accessCanCommand(client: AiTeamClient, options: AccessCanOptions = {}): Promise<void> {
  const path = ensurePath(options.path);
  const right = options.right ?? 'list';
  const response = await client.doIHavePermission({
    path,
    right,
    agent: options.agent,
  });

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  const badge = response.allowed ? chalk.green('ALLOWED') : chalk.red('DENIED');
  const target = response.contextLabel
    ? `${response.contextId} (${response.contextLabel})`
    : response.contextId;
  const selectedByBadge = '[' + response.selectedBy + ']';
  const headerPath = response.path.relative || response.path.input;

  console.log(chalk.bold(`\nAccess check for ${chalk.cyan(headerPath)} (${right})`));
  console.log('Context: ' + chalk.cyan(target) + ' ' + chalk.dim(selectedByBadge));
  console.log(`Result: ${badge}`);
  if (response.allRights.length > 0) {
    console.log(chalk.dim(`All rights for context on path: ${response.allRights.join(', ')}`));
  }
  console.log(chalk.dim(response.explanation));

  if (!response.allowed && response.alternativeContexts.length > 0) {
    console.log(chalk.yellow('\nAlternative contexts:'));
    for (const alt of response.alternativeContexts) {
      const allowedPathsBadge = '[' + alt.allowedPaths.join(', ') + ']';
      console.log('- ' + chalk.cyan(alt.contextId) + ' ' + chalk.dim(allowedPathsBadge));
    }
  }

  if (response.blockedByPatterns.length > 0) {
    console.log(chalk.dim(`Blocked by patterns: ${response.blockedByPatterns.join(', ')}`));
  }
  if (response.deniedByIgnore) {
    console.log(chalk.dim('Denied by ignore patterns.'));
  }

  console.log();
}
