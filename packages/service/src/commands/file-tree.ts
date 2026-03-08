import { getCachedFileTree, loadTeamConfig, saveTeamConfig, AgentManager, type Agent, type FileTreeNode, type GetFileTreeOptions, type TeamConfig } from '@ai-team/core';

type PathMode = 'read' | 'write' | 'create' | 'delete';

const DEFAULT_CONFIG: TeamConfig = { version: '1', randomAvatarUrls: [] };

/**
 * Return the workspace file tree using global read/write patterns as visibility overrides
 * for gitignored files/directories.
 */
export async function getFileTreeCommand(
  workspaceRoot: string,
  options: Omit<GetFileTreeOptions, 'allowPaths'> = {}
): Promise<FileTreeNode> {
  const config = await loadTeamConfig(workspaceRoot);
  const allowPaths = Array.from(new Set([
    ...(config?.fileTree?.readPaths ?? []),
    ...(config?.fileTree?.writePaths ?? []),
    ...(config?.fileTree?.createPaths ?? []),
    ...(config?.fileTree?.deletePaths ?? []),
  ]));
  return getCachedFileTree(workspaceRoot, { ...options, allowPaths });
}

/**
 * Add a path to the global read or write permission list in .ai-team/config.json.
 * Returns the updated path list for the selected mode.
 */
export async function allowPathCommand(
  workspaceRoot: string,
  filePath: string,
  mode: PathMode,
): Promise<string[]> {
  const config = await loadTeamConfig(workspaceRoot);
  const key = mode === 'write'
    ? 'writePaths'
    : mode === 'create'
      ? 'createPaths'
      : mode === 'delete'
        ? 'deletePaths'
        : 'readPaths';
  const current: string[] = (config?.fileTree as any)?.[key] ?? [];

  if (current.includes(filePath)) return current;

  const next = [...current, filePath];
  await saveTeamConfig(workspaceRoot, {
    ...DEFAULT_CONFIG,
    ...config,
    fileTree: { readPaths: [], writePaths: [], createPaths: [], deletePaths: [], ...config?.fileTree, [key]: next },
  });
  return next;
}

/**
 * Remove a path from the global read or write permission list in .ai-team/config.json.
 * Returns the updated path list for the selected mode.
 */
export async function disallowPathCommand(
  workspaceRoot: string,
  filePath: string,
  mode: PathMode,
): Promise<string[]> {
  const config = await loadTeamConfig(workspaceRoot);
  const key = mode === 'write'
    ? 'writePaths'
    : mode === 'create'
      ? 'createPaths'
      : mode === 'delete'
        ? 'deletePaths'
        : 'readPaths';
  const current: string[] = (config?.fileTree as any)?.[key] ?? [];
  const next = current.filter((p) => p !== filePath);

  if (next.length === current.length) return current;

  await saveTeamConfig(workspaceRoot, {
    ...DEFAULT_CONFIG,
    ...config,
    fileTree: { readPaths: [], writePaths: [], createPaths: [], deletePaths: [], ...config?.fileTree, [key]: next },
  });
  return next;
}

// ============================================================================
// Per-agent path permissions (stored in .ai-team/agents/<id>.md frontmatter)
// ============================================================================

export interface AgentPathResult {
  agent: Agent;
  /** Updated permission list for the given mode after the operation */
  paths: string[];
}

async function resolveOneAgent(workspaceRoot: string, query: string): Promise<Agent> {
  const manager = new AgentManager(workspaceRoot);
  await manager.initialize();
  const matches = manager.resolveAgent(query);
  if (matches.length === 0) throw new Error(`Agent not found: "${query}"`);
  if (matches.length > 1) {
    throw new Error(`Ambiguous agent "${query}" — matched: ${matches.map((a) => a.id).join(', ')}`);
  }
  return matches[0];
}

/**
 * Add a path to an agent's read or write permission list in their .md frontmatter.
 * Persists via AgentManager.updateAgent which writes the YAML frontmatter back to the .md file.
 */
export async function agentAllowPathCommand(
  workspaceRoot: string,
  agentQuery: string,
  filePath: string,
  mode: PathMode = 'read'
): Promise<AgentPathResult> {
  const agent = await resolveOneAgent(workspaceRoot, agentQuery);
  const manager = new AgentManager(workspaceRoot);
  await manager.initialize();

  const currentPerms = agent.permissions ?? { read: [], write: [], create: [], delete: [] };
  const current: string[] = currentPerms[mode] ?? [];

  if (current.includes(filePath)) return { agent, paths: current };

  const next = [...current, filePath];
  const updated = await manager.updateAgent(agent.id, {
    permissions: { ...currentPerms, [mode]: next },
  });
  return { agent: updated, paths: next };
}

/**
 * Remove a path from an agent's read or write permission list in their .md frontmatter.
 * Persists via AgentManager.updateAgent which writes the YAML frontmatter back to the .md file.
 */
export async function agentDisallowPathCommand(
  workspaceRoot: string,
  agentQuery: string,
  filePath: string,
  mode: PathMode = 'read'
): Promise<AgentPathResult> {
  const agent = await resolveOneAgent(workspaceRoot, agentQuery);
  const manager = new AgentManager(workspaceRoot);
  await manager.initialize();

  const currentPerms = agent.permissions ?? { read: [], write: [], create: [], delete: [] };
  const current: string[] = currentPerms[mode] ?? [];
  const next = current.filter((p) => p !== filePath);

  if (next.length === current.length) return { agent, paths: current };

  const updated = await manager.updateAgent(agent.id, {
    permissions: { ...currentPerms, [mode]: next },
  });
  return { agent: updated, paths: next };
}
