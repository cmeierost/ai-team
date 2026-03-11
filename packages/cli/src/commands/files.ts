/**
 * files command - preview the workspace file tree with gitignore awareness
 */

import chalk from 'chalk';
import { type FileTreeNode, type AnnotatedFile, AgentManager, ContextManager, createAccessEngine, loadAgentAccessPatterns, loadTeamConfig } from '@ai-team/core';
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
  agent?: string;
  writeable?: boolean;
}

type PathMode = 'read' | 'write' | 'create' | 'delete';

function resolvePathMode(options: AllowOptions): PathMode {
  if (options.mode) {
    if (options.mode === 'read' || options.mode === 'write' || options.mode === 'create' || options.mode === 'delete') {
      return options.mode;
    }
    throw new Error(`Invalid mode "${options.mode}". Use one of: read, write, create, delete.`);
  }

  return options.write ? 'write' : 'read';
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

  // Agent-scoped file listing
  if (options.agent) {
    const agentManager = new AgentManager(workspaceRoot);
    await agentManager.initialize();

    const matches = agentManager.resolveAgent(options.agent);
    if (matches.length === 0) {
      console.log(chalk.red(`  Agent not found: "${options.agent}"`));
      process.exit(1);
    }
    const agent = matches[0];

    const tree = await getFileTreeCommand(workspaceRoot, {
      maxDepth: options.depth ? Number.parseInt(options.depth, 10) : 6,
      includeHidden: options.all ?? false,
      ignoreGitignore: options.noGitignore ?? false,
    });

    const allFiles = flattenFiles(tree);
    const config = await loadTeamConfig(workspaceRoot);
    const engine = createAccessEngine({
      workspaceRoot,
      fileTreeConfig: config?.fileTree,
      agents: agentManager.getAllAgents(),
    });
    const contextManager = ContextManager.fromConfig(workspaceRoot, config?.fileTree, engine);
    const accessPatterns = await loadAgentAccessPatterns(workspaceRoot, agent.id);

    if (options.writeable) {
      // Legacy behaviour: only writable files
      const filtered = contextManager.getWritableFiles(agent, allFiles);
      const patterns = accessPatterns.write ?? [];
      const agentLabel = chalk.cyan(agent.name) + ' ' + chalk.dim(`(${agent.id})`);

      console.log(chalk.bold(`\n  Agent: ${agentLabel}`));
      console.log(chalk.dim(`  Role: ${agent.role}  |  Mode: write`));
      console.log(chalk.dim(`  Patterns: ${patterns.length > 0 ? patterns.join(', ') : '(none)'}\n`));

      if (filtered.length === 0) {
        console.log(chalk.yellow(`  No writable files.`));
        if (patterns.length === 0) {
          console.log(chalk.dim(`  This agent has no write permission patterns defined.`));
        }
        console.log();
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ agent: agent.id, mode: 'write', patterns, files: filtered }, null, 2));
        return;
      }

      for (const file of filtered) {
        console.log(`  ${chalk.dim('📄')} ${file}`);
      }
      console.log(chalk.dim(`\n  ${filtered.length} file${filtered.length === 1 ? '' : 's'} writable\n`));
      return;
    }

    // Default: annotated view showing read/write per file
    const annotated = contextManager.getAnnotatedFiles(agent, allFiles);
    const withAccess = annotated.filter(f => f.readable || f.writable);

    const readPatterns = accessPatterns.read ?? [];
    const writePatterns = accessPatterns.write ?? [];
    const agentLabel = chalk.cyan(agent.name) + ' ' + chalk.dim(`(${agent.id})`);

    console.log(chalk.bold(`\n  Agent: ${agentLabel}`));
    console.log(chalk.dim(`  Role: ${agent.role}`));
    console.log(chalk.dim(`  Read patterns:  ${readPatterns.length > 0 ? readPatterns.join(', ') : '(none)'}`));
    console.log(chalk.dim(`  Write patterns: ${writePatterns.length > 0 ? writePatterns.join(', ') : '(none)'}\n`));

    if (withAccess.length === 0) {
      console.log(chalk.yellow(`  No accessible files.`));
      if (readPatterns.length === 0 && writePatterns.length === 0) {
        console.log(chalk.dim(`  This agent has no permission patterns defined.`));
      }
      console.log();
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({
        agent: agent.id,
        readPatterns,
        writePatterns,
        files: withAccess,
      }, null, 2));
      return;
    }

    for (const f of withAccess) {
      const flags = formatPermFlags(f);
      console.log(`  ${flags} ${f.path}`);
    }

    const readCount = withAccess.filter(f => f.readable).length;
    const writeCount = withAccess.filter(f => f.writable).length;
    console.log(chalk.dim(`\n  ${withAccess.length} file${withAccess.length === 1 ? '' : 's'} accessible (${readCount} readable, ${writeCount} writable)\n`));
    return;
  }

  // Default: show workspace file tree
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

/** Format permission flags as coloured [R][W] badges */
function formatPermFlags(f: AnnotatedFile): string {
  const r = f.readable ? chalk.green('R') : chalk.dim('-');
  const w = f.writable ? chalk.yellow('W') : chalk.dim('-');
  return `[${r}${w}]`;
}

/** Iteratively collect all non-directory relative paths from a FileTreeNode */
function flattenFiles(root: FileTreeNode): string[] {
  const files: string[] = [];
  const stack: FileTreeNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!node.isDirectory && node.relativePath !== '') {
      files.push(node.relativePath);
    }
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }
  return files;
}

export interface AllowOptions {
  agent?: string;
  write?: boolean;
  mode?: string;
}

export async function filesAllowCommand(filePath: string, options: AllowOptions = {}): Promise<void> {
  const workspaceRoot = findWorkspaceRoot();
  const mode = resolvePathMode(options);
  if (options.agent) {
    const result = await agentAllowPathCommand(workspaceRoot, options.agent, filePath, mode);
    console.log(chalk.green(`  ✔ ${filePath} added to agent ${result.agent.id} ${mode} permissions`));
    console.log(chalk.dim(`  ${mode}: ${result.paths.join(', ') || '(none)'}`));
  } else {
    const next = await allowPathCommand(workspaceRoot, filePath, mode);
    console.log(chalk.green(`  ✔ ${filePath} added to global ${mode} permissions`));
    console.log(chalk.dim(`  .ai-team/config.json fileTree.${mode === 'write' ? 'writePaths' : 'readPaths'} (${next.length} path${next.length === 1 ? '' : 's'})`));
  }
}

export async function filesDisallowCommand(filePath: string, options: AllowOptions = {}): Promise<void> {
  const workspaceRoot = findWorkspaceRoot();
  const mode = resolvePathMode(options);
  if (options.agent) {
    const result = await agentDisallowPathCommand(workspaceRoot, options.agent, filePath, mode);
    console.log(chalk.green(`  ✔ ${filePath} removed from agent ${result.agent.id} ${mode} permissions`));
    console.log(chalk.dim(`  ${mode}: ${result.paths.join(', ') || '(none)'}`));
  } else {
    const next = await disallowPathCommand(workspaceRoot, filePath, mode);
    console.log(chalk.green(`  ✔ ${filePath} removed from global ${mode} permissions`));
    console.log(chalk.dim(`  .ai-team/config.json fileTree.${mode}Paths (${next.length} path${next.length === 1 ? '' : 's'})`));
  }
}

export async function filesPatternsCommand(options: { agent?: string; json?: boolean } = {}): Promise<void> {
  const workspaceRoot = findWorkspaceRoot();
  const config = await loadTeamConfig(workspaceRoot);

  const global = {
    read: config?.fileTree?.readPaths ?? [],
    write: config?.fileTree?.writePaths ?? [],
    create: config?.fileTree?.createPaths ?? [],
    delete: config?.fileTree?.deletePaths ?? [],
  };

  if (!options.agent) {
    if (options.json) {
      console.log(JSON.stringify({ global }, null, 2));
      return;
    }

    console.log(chalk.bold('\n  Global file patterns (.ai-team/config.json)'));
    (Object.entries(global) as Array<[PathMode, string[]]>).forEach(([mode, values]) => {
      console.log(chalk.dim(`  ${mode}: ${values.join(', ') || '(none)'}`));
    });
    console.log();
    return;
  }

  const manager = new AgentManager(workspaceRoot);
  await manager.initialize();
  const matches = manager.resolveAgent(options.agent);
  if (matches.length === 0) {
    throw new Error(`Agent not found: "${options.agent}"`);
  }
  const agent = matches[0];
  const patterns = await loadAgentAccessPatterns(workspaceRoot, agent.id);

  if (options.json) {
    console.log(JSON.stringify({
      agent: { id: agent.id, name: agent.name, role: agent.role },
      global,
      agentPatterns: patterns,
    }, null, 2));
    return;
  }

  console.log(chalk.bold(`\n  Agent file patterns (${agent.name} / ${agent.id})`));
  console.log(chalk.dim(`  Source: .ai-team/agents/${agent.id}.access`));
  (Object.entries(patterns) as Array<[PathMode, string[]]>).forEach(([mode, values]) => {
    console.log(chalk.dim(`  ${mode}: ${values.join(', ') || '(none)'}`));
  });
  console.log();
}
