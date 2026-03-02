/**
 * files command - preview the workspace file tree with gitignore awareness
 */

import chalk from 'chalk';
import { type FileTreeNode } from '@ai-team/core';
import {
  findWorkspaceRoot,
  getFileTreeCommand,
  allowPathCommand,
  disallowPathCommand,
  agentAllowPathCommand,
  agentDisallowPathCommand,
} from '@ai-team/service';

interface FilesOptions {
  depth?: string;
  all?: boolean;
  noGitignore?: boolean;
  json?: boolean;
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

export async function filesCommand(options: FilesOptions = {}): Promise<void> {
  const workspaceRoot = findWorkspaceRoot();
  const maxDepth = options.depth ? Number.parseInt(options.depth, 10) : 4;

  const tree = await getFileTreeCommand(workspaceRoot, {
    maxDepth,
    includeHidden: options.all ?? false,
    ignoreGitignore: options.noGitignore ?? false,
  });

  if (options.json) {
    console.log(JSON.stringify(tree, null, 2));
    return;
  }

  console.log(chalk.bold(`\n  Workspace: ${chalk.cyan(workspaceRoot)}\n`));
  console.log(chalk.dim(`  (depth: ${maxDepth}, hidden: ${options.all ? 'shown' : 'hidden'}, gitignore: ${options.noGitignore ? 'off' : 'on'})\n`));

  if (!tree.children || tree.children.length === 0) {
    console.log(chalk.yellow('  No files found.'));
    return;
  }

  tree.children.forEach((child, i) => {
    const last = i === tree.children!.length - 1;
    printTree(child, '  ', last);
  });

  console.log();
}

export interface AllowOptions {
  agent?: string;
  write?: boolean;
}

export async function filesAllowCommand(filePath: string, options: AllowOptions = {}): Promise<void> {
  const workspaceRoot = findWorkspaceRoot();
  const mode = options.write ? 'write' : 'read';
  if (options.agent) {
    const result = await agentAllowPathCommand(workspaceRoot, options.agent, filePath, mode);
    console.log(chalk.green(`  ✔ ${filePath} added to agent ${result.agent.id} ${mode} permissions`));
    console.log(chalk.dim(`  ${mode}: ${result.paths.join(', ') || '(none)'}`));
  } else {
    const next = await allowPathCommand(workspaceRoot, filePath);
    console.log(chalk.green(`  ✔ ${filePath} is in the allow list`));
    console.log(chalk.dim(`  .ai-team/config.json (${next.length} path${next.length === 1 ? '' : 's'})`));
  }
}

export async function filesDisallowCommand(filePath: string, options: AllowOptions = {}): Promise<void> {
  const workspaceRoot = findWorkspaceRoot();
  const mode = options.write ? 'write' : 'read';
  if (options.agent) {
    const result = await agentDisallowPathCommand(workspaceRoot, options.agent, filePath, mode);
    console.log(chalk.green(`  ✔ ${filePath} removed from agent ${result.agent.id} ${mode} permissions`));
    console.log(chalk.dim(`  ${mode}: ${result.paths.join(', ') || '(none)'}`));
  } else {
    const next = await disallowPathCommand(workspaceRoot, filePath);
    console.log(chalk.green(`  ✔ ${filePath} removed from allow list`));
    console.log(chalk.dim(`  .ai-team/config.json (${next.length} path${next.length === 1 ? '' : 's'})`));
  }
}
