import {
  getCachedFileTree,
  loadAgentAccessPatterns,
  loadTeamConfig,
  saveAgentAccessPatterns,
  saveTeamConfig,
  AgentManager,
  type Agent,
  type FileTreeNode,
  type GetFileTreeOptions,
  type TeamConfig,
} from '@ai-team/core';

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

async function syncAgentFrontmatterPermissions(
  manager: AgentManager,
  agent: Agent,
  patterns: { read: string[]; write: string[]; create: string[]; delete: string[] },
): Promise<Agent> {
  const currentPerms = agent.permissions ?? { read: [], write: [], create: [], delete: [] };
  const sameRead = JSON.stringify(currentPerms.read ?? []) === JSON.stringify(patterns.read);
  const sameWrite = JSON.stringify(currentPerms.write ?? []) === JSON.stringify(patterns.write);
  const sameCreate = JSON.stringify(currentPerms.create ?? []) === JSON.stringify(patterns.create);
  const sameDelete = JSON.stringify(currentPerms.delete ?? []) === JSON.stringify(patterns.delete);

  if (sameRead && sameWrite && sameCreate && sameDelete) {
    return agent;
  }

  return manager.updateAgent(agent.id, {
    permissions: {
      ...currentPerms,
      read: patterns.read,
      write: patterns.write,
      create: patterns.create,
      delete: patterns.delete,
    },
  });
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

  const accessPatterns = await loadAgentAccessPatterns(workspaceRoot, agent.id);
  const current = accessPatterns[mode] ?? [];

  const nextPatterns = current.includes(filePath)
    ? accessPatterns
    : { ...accessPatterns, [mode]: [...current, filePath] };

  await saveAgentAccessPatterns(workspaceRoot, agent.id, nextPatterns);
  const updated = await syncAgentFrontmatterPermissions(manager, agent, nextPatterns);

  return { agent: updated, paths: nextPatterns[mode] };
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

  const accessPatterns = await loadAgentAccessPatterns(workspaceRoot, agent.id);
  const current = accessPatterns[mode] ?? [];
  const next = current.filter((p) => p !== filePath);

  const nextPatterns = next.length === current.length
    ? accessPatterns
    : { ...accessPatterns, [mode]: next };

  await saveAgentAccessPatterns(workspaceRoot, agent.id, nextPatterns);
  const updated = await syncAgentFrontmatterPermissions(manager, agent, nextPatterns);

  return { agent: updated, paths: nextPatterns[mode] };
}
