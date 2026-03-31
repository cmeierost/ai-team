import chalk from 'chalk';
import type { FilePermission, AiTeamClient, PermissionOverlapReport, RightOverlapSummary } from '@ai-team/api-client';

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

interface AccessOverlapOptions {
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

function filterRightSummary(summary: RightOverlapSummary, agentId?: string): RightOverlapSummary {
  if (!agentId) {
    return summary;
  }

  return {
    ...summary,
    sharedAllowPatterns: summary.sharedAllowPatterns.filter((entry) => entry.agentIds.includes(agentId)),
    sharedDenyPatterns: summary.sharedDenyPatterns.filter((entry) => entry.agentIds.includes(agentId)),
    agents: summary.agents.filter((entry) => entry.agentId === agentId),
    pairs: summary.pairs.filter((entry) => entry.agentA === agentId || entry.agentB === agentId),
  };
}

function filterOverlapReport(report: PermissionOverlapReport, options: AccessOverlapOptions): PermissionOverlapReport {
  const requestedRights = options.right
    ? [options.right]
    : (['read', 'list', 'write', 'create', 'delete'] as const);

  const agentIds = options.agent
    ? report.agentIds.filter((agentId) => agentId === options.agent)
    : report.agentIds;

  return {
    ...report,
    agentIds,
    rights: {
      read: requestedRights.includes('read') ? filterRightSummary(report.rights.read, options.agent) : emptyRightSummary('read'),
      write: requestedRights.includes('write') ? filterRightSummary(report.rights.write, options.agent) : emptyRightSummary('write'),
      create: requestedRights.includes('create') ? filterRightSummary(report.rights.create, options.agent) : emptyRightSummary('create'),
      delete: requestedRights.includes('delete') ? filterRightSummary(report.rights.delete, options.agent) : emptyRightSummary('delete'),
      list: requestedRights.includes('list') ? filterRightSummary(report.rights.list, options.agent) : emptyRightSummary('list'),
    },
  };
}

function emptyRightSummary(right: FilePermission): RightOverlapSummary {
  return {
    right,
    totalDistinctAllowPatterns: 0,
    totalDistinctDenyPatterns: 0,
    sharedAllowPatterns: [],
    sharedDenyPatterns: [],
    agents: [],
    pairs: [],
  };
}

function formatPairLine(summary: RightOverlapSummary): string[] {
  return summary.pairs
    .filter((entry) => entry.sharedAllowPatterns.length > 0 || entry.sharedDenyPatterns.length > 0)
    .slice(0, 5)
    .map((entry) => {
      const allowCount = entry.sharedAllowPatterns.length;
      const denyCount = entry.sharedDenyPatterns.length;
      const ratio = `${(entry.overlapRatio * 100).toFixed(1)}%`;
      return `- ${chalk.cyan(entry.agentA)} <> ${chalk.cyan(entry.agentB)}: `
        + `${allowCount} shared allow, ${denyCount} shared deny, ${ratio} allow overlap`;
    });
}

function formatSharedPatternLines(label: string, entries: Array<{ pattern: string; agentIds: string[] }>): string[] {
  if (entries.length === 0) {
    return [];
  }

  const lines = [chalk.yellow(label)];
  for (const entry of entries.slice(0, 8)) {
    lines.push(`- ${chalk.cyan(entry.pattern)} ${chalk.dim(`[${entry.agentIds.join(', ')}]`)}`);
  }

  if (entries.length > 8) {
    lines.push(chalk.dim(`...and ${entries.length - 8} more`));
  }

  return lines;
}

export async function accessOverlapCommand(client: AiTeamClient, options: AccessOverlapOptions = {}): Promise<void> {
  const report = await client.analyzePermissionOverlap();
  if (options.agent && !report.agentIds.includes(options.agent)) {
    throw new Error(`Unknown agent id '${options.agent}' in permission overlap report`);
  }

  const filtered = filterOverlapReport(report, options);

  if (options.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  console.log(chalk.bold(`\nPermission overlap across ${chalk.cyan(String(filtered.agentIds.length))} agent(s)`));
  console.log(chalk.dim(`Generated at ${filtered.generatedAt}`));

  const rightsToShow = options.right
    ? [options.right]
    : (['read', 'list', 'write', 'create', 'delete'] as const);

  let printedAny = false;
  for (const right of rightsToShow) {
    const summary = filtered.rights[right];
    const pairLines = formatPairLine(summary);
    const sharedAllowLines = formatSharedPatternLines('Shared allow patterns:', summary.sharedAllowPatterns);
    const sharedDenyLines = formatSharedPatternLines('Shared deny patterns:', summary.sharedDenyPatterns);

    if (pairLines.length === 0 && sharedAllowLines.length === 0 && sharedDenyLines.length === 0) {
      continue;
    }

    printedAny = true;
    console.log(chalk.bold(`\n${right.toUpperCase()}`));
    console.log(chalk.dim(`Distinct allow patterns: ${summary.totalDistinctAllowPatterns}; distinct deny patterns: ${summary.totalDistinctDenyPatterns}`));

    if (pairLines.length > 0) {
      console.log(chalk.yellow('Top overlapping pairs:'));
      for (const line of pairLines) {
        console.log(line);
      }
    }

    for (const line of sharedAllowLines) {
      console.log(line);
    }
    for (const line of sharedDenyLines) {
      console.log(line);
    }
  }

  if (!printedAny) {
    console.log(chalk.dim('\nNo overlapping permission patterns found for the selected filters.\n'));
    return;
  }

  console.log();
}
