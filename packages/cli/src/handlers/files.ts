/**
 * files command - pure CLI renderers for workspace file tree and patterns
 */

import chalk from 'chalk';
import type { FileTreeNode } from '@ai-team/infrastructure';
import type { FilesTreeResponse, FilesPatternsResponse } from '@ai-team/api-client';
import type { ICliCommandClient } from '../cli-command-client.js';
import { runCommandStream } from './stream-runner.js';

type PathMode = 'read' | 'write';

interface FilesOptions {
  depth?: string;
  all?: boolean;
  noGitignore?: boolean;
  json?: boolean;
  agent?: string;
  writeable?: boolean;
}

function printTree(node: FileTreeNode, prefix = '', isLast = true): void {
  const connector = isLast ? '└─' : '├─';
  const childPrefix = prefix + (isLast ? '   ' : '│  ');

  if (node.relativePath !== '') {
    const icon = node.isDirectory ? '📁' : '📄';
    const label = node.isDirectory ? chalk.cyan.bold(node.name) : node.name;
    const ignored = node.gitignored ? chalk.dim(' [gitignored/allowed]') : '';
    console.log(`${prefix}${connector} ${icon} ${label}${ignored}`);
  }

  if (node.children) {
    node.children.forEach((child, i) => {
      const last = i === node.children!.length - 1;
      printTree(child, node.relativePath === '' ? '' : childPrefix, last);
    });
  }
}

function formatPermFlags(f: { readable: boolean; writable: boolean }): string {
  const r = f.readable ? chalk.green('R') : chalk.dim('-');
  const w = f.writable ? chalk.yellow('W') : chalk.dim('-');
  return `[${r}${w}]`;
}

export function renderFilesTree(data: FilesTreeResponse, options: FilesOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Agent-scoped: writable files only
  if (data.agent && data.writeableFiles) {
    const agentLabel = chalk.cyan(data.agent.name) + ' ' + chalk.dim(`(${data.agent.id})`);
    const patterns = data.writePatterns ?? [];

    console.log(chalk.bold(`\n  Agent: ${agentLabel}`));
    console.log(chalk.dim(`  Role: ${data.agent.role}  |  Mode: write`));
    console.log(chalk.dim(`  Patterns: ${patterns.length > 0 ? patterns.join(', ') : '(none)'}\n`));

    if (data.writeableFiles.length === 0) {
      console.log(chalk.yellow(`  No writable files.`));
      if (patterns.length === 0) {
        console.log(chalk.dim(`  This agent has no write permission patterns defined.`));
      }
      console.log();
      return;
    }

    for (const file of data.writeableFiles) {
      console.log(`  ${chalk.dim('📄')} ${file}`);
    }
    console.log(
      chalk.dim(
        `\n  ${data.writeableFiles.length} file${data.writeableFiles.length === 1 ? '' : 's'} writable\n`
      )
    );
    return;
  }

  // Agent-scoped: annotated view
  if (data.agent && data.annotatedFiles) {
    const readPatterns = data.readPatterns ?? [];
    const writePatterns = data.writePatterns ?? [];
    const agentLabel = chalk.cyan(data.agent.name) + ' ' + chalk.dim(`(${data.agent.id})`);

    console.log(chalk.bold(`\n  Agent: ${agentLabel}`));
    console.log(chalk.dim(`  Role: ${data.agent.role}`));
    console.log(
      chalk.dim(`  Read patterns:  ${readPatterns.length > 0 ? readPatterns.join(', ') : '(none)'}`)
    );
    console.log(
      chalk.dim(
        `  Write patterns: ${writePatterns.length > 0 ? writePatterns.join(', ') : '(none)'}\n`
      )
    );

    if (data.annotatedFiles.length === 0) {
      console.log(chalk.yellow(`  No accessible files.`));
      if (readPatterns.length === 0 && writePatterns.length === 0) {
        console.log(chalk.dim(`  This agent has no permission patterns defined.`));
      }
      console.log();
      return;
    }

    for (const f of data.annotatedFiles) {
      const flags = formatPermFlags(f);
      console.log(`  ${flags} ${f.path}`);
    }

    const readCount = data.annotatedFiles.filter((f) => f.readable).length;
    const writeCount = data.annotatedFiles.filter((f) => f.writable).length;
    console.log(
      chalk.dim(
        `\n  ${data.annotatedFiles.length} file${data.annotatedFiles.length === 1 ? '' : 's'} accessible (${readCount} readable, ${writeCount} writable)\n`
      )
    );
    return;
  }

  // Default: workspace file tree
  if (!data.tree) {
    console.log(chalk.yellow('  No file tree data.'));
    return;
  }

  console.log(chalk.bold(`\n  Workspace: ${chalk.cyan(data.workspaceRoot)}\n`));
  console.log(
    chalk.dim(
      `  (depth: ${data.maxDepth}, hidden: ${data.includeHidden ? 'shown' : 'hidden'}, gitignore: ${data.ignoreGitignore ? 'off' : 'on'})\n`
    )
  );

  if (!data.tree.children || data.tree.children.length === 0) {
    console.log(chalk.yellow('  No files found.'));
    return;
  }

  data.tree.children.forEach((child, i) => {
    const last = i === data.tree!.children!.length - 1;
    printTree(child, '  ', last);
  });

  console.log();
}

export function renderFilesPatterns(
  data: FilesPatternsResponse,
  options: { json?: boolean } = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!data.agent) {
    console.log(chalk.bold('\n  Global file patterns (.ai-team/config.json)'));
    (Object.entries(data.global) as Array<[PathMode, string[]]>).forEach(([mode, values]) => {
      console.log(chalk.dim(`  ${mode}: ${values.join(', ') || '(none)'}`));
    });
    console.log();
    return;
  }

  console.log(chalk.bold(`\n  Agent file patterns (${data.agent.name} / ${data.agent.id})`));
  console.log(chalk.dim(`  Source: .ai-team/agents/${data.agent.id}.perm`));
  if (data.agentPatterns) {
    (Object.entries(data.agentPatterns) as Array<[PathMode, string[]]>).forEach(
      ([mode, values]) => {
        console.log(chalk.dim(`  ${mode}: ${values.join(', ') || '(none)'}`));
      }
    );
  }
  console.log();
}

export interface AllowOptions {
  agent?: string;
  write?: boolean;
  mode?: string;
  requestedBy?: string;
  approvedByUser?: boolean;
}

export async function renderFilesAllow(
  commandClient: ICliCommandClient,
  filePath: string,
  options: AllowOptions = {}
): Promise<void> {
  await runCommandStream(commandClient, {
    command: 'filesAllow',
    payload: {
      path: filePath,
      agent: options.agent,
      mode: options.mode ?? (options.write ? 'write' : 'read'),
      requestedBy: options.requestedBy,
      approvedByUser: options.approvedByUser,
    },
  });
}

export async function renderFilesDeny(
  commandClient: ICliCommandClient,
  filePath: string,
  options: AllowOptions = {}
): Promise<void> {
  await runCommandStream(commandClient, {
    command: 'filesDeny',
    payload: {
      path: filePath,
      agent: options.agent,
      mode: options.mode ?? (options.write ? 'write' : 'read'),
      requestedBy: options.requestedBy,
      approvedByUser: options.approvedByUser,
    },
  });
}
