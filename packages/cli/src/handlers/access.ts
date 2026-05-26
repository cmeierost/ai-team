import chalk from 'chalk';
import type {
  FilePermission,
  WhoHasPermissionResponse,
  DoIHavePermissionResponse,
  PermissionOverlapReport,
  RightOverlapSummary,
  FilePermissionOverlapReport,
  PatternOverlapReport,
} from '@ai-team/api-contracts';

interface JsonOption {
  json?: boolean;
}

interface AccessOverlapRenderOptions {
  right?: FilePermission;
  agent?: string;
  json?: boolean;
}

export function renderAccessWho(
  response: WhoHasPermissionResponse,
  options: JsonOption = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  const right = response.right;
  console.log(
    chalk.bold(
      `\nAccess candidates for ${chalk.cyan(response.path.relative || response.path.input)} (${right})`
    )
  );
  if (response.contexts.length === 0) {
    console.log(chalk.yellow('No contexts can access this path/right.'));
    console.log(chalk.dim(response.explanation));
    console.log();
    return;
  }

  for (const context of response.contexts) {
    console.log(
      `- ${chalk.cyan(context.contextId)}${context.label ? chalk.dim(` (${context.label})`) : ''}`
    );
  }
  console.log(chalk.dim(`\n${response.explanation}\n`));
}

export function renderAccessCan(
  response: DoIHavePermissionResponse,
  options: JsonOption = {}
): void {
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

  console.log(chalk.bold(`\nAccess check for ${chalk.cyan(headerPath)} (${response.right})`));
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
    sharedPatterns: summary.sharedPatterns.filter((entry) => entry.agentIds.includes(agentId)),
  };
}

function filterOverlapReport(
  report: PermissionOverlapReport,
  options: AccessOverlapRenderOptions
): PermissionOverlapReport {
  if (report.kind === 'files') {
    return report;
  }

  const requestedRights = options.right ? [options.right] : (['read', 'list', 'write'] as const);

  const agentIds = options.agent
    ? report.agentIds.filter((agentId) => agentId === options.agent)
    : report.agentIds;

  return {
    ...report,
    agentIds,
    rights: {
      read: requestedRights.includes('read')
        ? filterRightSummary(report.rights.read, options.agent)
        : emptyRightSummary('read'),
      write: requestedRights.includes('write')
        ? filterRightSummary(report.rights.write, options.agent)
        : emptyRightSummary('write'),
      list: requestedRights.includes('list')
        ? filterRightSummary(report.rights.list, options.agent)
        : emptyRightSummary('list'),
    },
  };
}

function emptyRightSummary(right: FilePermission): RightOverlapSummary {
  return {
    right,
    agentIds: [],
    sharedPatterns: [],
  };
}

function formatSharedPatternLines(
  label: string,
  entries: Array<{ pattern: string; agentIds: string[] }>
): string[] {
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

function renderPatternOverlapReport(
  report: PatternOverlapReport,
  options: AccessOverlapRenderOptions
): void {
  if (options.agent && !report.agentIds.includes(options.agent)) {
    throw new Error(`Unknown agent id '${options.agent}' in permission overlap report`);
  }

  const filtered = filterOverlapReport(report, options) as PatternOverlapReport;

  console.log(
    chalk.bold(
      `\nPermission overlap across ${chalk.cyan(String(filtered.agentIds.length))} agent(s)`
    )
  );
  console.log(chalk.dim(`Mode: patterns`));
  console.log(chalk.dim(`Generated at ${filtered.generatedAt}`));

  const rightsToShow = options.right ? [options.right] : (['read', 'list', 'write'] as const);

  let printedAny = false;
  for (const right of rightsToShow) {
    const summary = filtered.rights[right];
    const sharedLines = formatSharedPatternLines('Shared patterns:', summary.sharedPatterns);

    if (sharedLines.length === 0) {
      continue;
    }

    printedAny = true;
    console.log(chalk.bold(`\n${right.toUpperCase()}`));
    console.log(chalk.dim(`Shared patterns: ${summary.sharedPatterns.length}`));

    for (const line of sharedLines) {
      console.log(line);
    }
  }

  if (!printedAny) {
    console.log(
      chalk.dim('\nNo overlapping permission patterns found for the selected filters.\n')
    );
    return;
  }

  console.log();
}

function formatOwnershipLines(
  entries: Array<{ path: string; agentIds: string[]; lineCount: number }>,
  limit = 8
): string[] {
  const lines = entries
    .slice(0, limit)
    .map(
      (entry) =>
        `- ${chalk.cyan(entry.path)} ${chalk.dim(`[${entry.agentIds.join(', ')} | ${entry.lineCount} lines]`)}`
    );

  if (entries.length > limit) {
    lines.push(chalk.dim(`...and ${entries.length - limit} more`));
  }

  return lines;
}

function formatExtensionLines(
  entries: Array<{ extension: string; fileCount: number; lineCount: number }>,
  limit = 8
): string[] {
  const lines = entries
    .slice(0, limit)
    .map(
      (entry) =>
        `- ${chalk.cyan(entry.extension)}: ${entry.fileCount} files, ${entry.lineCount} lines`
    );

  if (entries.length > limit) {
    lines.push(chalk.dim(`...and ${entries.length - limit} more`));
  }

  return lines;
}

function renderFileOverlapReport(
  report: FilePermissionOverlapReport,
  options: AccessOverlapRenderOptions
): void {
  console.log(
    chalk.bold(
      `\nWorkspace permission overlap across ${chalk.cyan(String(report.agentIds.length))} agent(s)`
    )
  );
  console.log(chalk.dim(`Mode: files`));
  console.log(chalk.dim(`Generated at ${report.generatedAt}`));
  console.log(chalk.dim(`Workspace files analyzed: ${report.workspaceFileCount}`));

  const rightsToShow = options.right ? [options.right] : (['read', 'list', 'write'] as const);

  for (const right of rightsToShow) {
    const summary = report.rights[right];
    console.log(chalk.bold(`\n${right.toUpperCase()}`));
    console.log(
      chalk.dim(
        `Total: ${summary.totalFiles}; uncovered: ${summary.uncoveredFiles.length}; ` +
          `single-owner: ${summary.singlyOwnedFiles.length}; overlapping: ${summary.overlappingFiles.length}`
      )
    );

    if (options.agent && report.agentFocus) {
      const focused = report.agentFocus.rights[right] as {
        responsibility: {
          byExtension: Array<{ extension: string; fileCount: number; lineCount: number }>;
        };
        overlapsWith: Array<{
          otherAgentId: string;
          sharedFileCount: number;
          sharedLineCount: number;
          overlapRatio: number;
        }>;
        uniqueFiles: Array<{ path: string; agentIds: string[]; lineCount: number }>;
      };
      console.log(chalk.yellow(`Responsibility for ${options.agent}:`));
      for (const line of formatExtensionLines(focused.responsibility.byExtension)) {
        console.log(line);
      }

      if (focused.overlapsWith.length > 0) {
        console.log(chalk.yellow('Overlapping agents:'));
        for (const overlap of focused.overlapsWith.slice(0, 8)) {
          console.log(
            `- ${chalk.cyan(overlap.otherAgentId)}: ` +
              `${overlap.sharedFileCount} shared files, ${overlap.sharedLineCount} shared lines, ` +
              `${(overlap.overlapRatio * 100).toFixed(1)}% overlap`
          );
        }
      }

      if (focused.uniqueFiles.length > 0) {
        console.log(chalk.yellow('Files unique to selected agent:'));
        for (const line of formatOwnershipLines(focused.uniqueFiles)) {
          console.log(line);
        }
      }
    } else {
      const topResponsibility = summary.agentResponsibilities.slice(0, 5);
      if (topResponsibility.length > 0) {
        console.log(chalk.yellow('Top agent responsibility:'));
        for (const responsibility of topResponsibility) {
          console.log(
            `- ${chalk.cyan(responsibility.agentId)}: ` +
              `${responsibility.fileCount} files, ${responsibility.lineCount} lines`
          );
        }
      }

      const topPairs = summary.pairs.filter((pair) => pair.sharedFileCount > 0).slice(0, 5);
      if (topPairs.length > 0) {
        console.log(chalk.yellow('Closest overlapping pairs:'));
        for (const pair of topPairs) {
          console.log(
            `- ${chalk.cyan(pair.agentA)} <> ${chalk.cyan(pair.agentB)}: ` +
              `${pair.sharedFileCount} shared files, ${pair.sharedLineCount} shared lines, ` +
              `${(pair.overlapRatio * 100).toFixed(1)}% overlap`
          );
        }
      }
    }

    if (summary.overlappingFiles.length > 0) {
      console.log(chalk.yellow('Top overlapping files:'));
      for (const line of formatOwnershipLines(summary.overlappingFiles)) {
        console.log(line);
      }
    }

    if (summary.uncoveredFiles.length > 0) {
      console.log(chalk.yellow('Top uncovered files:'));
      for (const line of formatOwnershipLines(summary.uncoveredFiles)) {
        console.log(line);
      }
    }
  }

  console.log();
}

export function renderAccessOverlap(
  report: PermissionOverlapReport,
  options: AccessOverlapRenderOptions = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.kind === 'patterns') {
    renderPatternOverlapReport(report, options);
    return;
  }

  renderFileOverlapReport(report, options);
}
