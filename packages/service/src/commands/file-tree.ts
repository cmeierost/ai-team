import { getFileTree, loadTeamConfig, saveTeamConfig, AgentManager, type Agent, type FileTreeNode, type GetFileTreeOptions, type TeamConfig } from '@ai-team/core';

const DEFAULT_CONFIG: TeamConfig = { version: '1', randomAvatarUrls: [] };

/**
 * Return the workspace file tree, automatically reading allowPaths from
 * .ai-team/config.json and merging them with any caller-supplied allowPaths.
 */
export async function getFileTreeCommand(
  workspaceRoot: string,
  options: Omit<GetFileTreeOptions, 'allowPaths'> = {}
): Promise<FileTreeNode> {
  const config = await loadTeamConfig(workspaceRoot);
  const allowPaths = config?.fileTree?.allowPaths ?? [];
  return getFileTree(workspaceRoot, { ...options, allowPaths });
}

/**
 * Add a path to the gitignore allow-list stored in .ai-team/config.json.
 * Returns the updated allow list.
 */
export async function allowPathCommand(workspaceRoot: string, filePath: string): Promise<string[]> {
  const config = await loadTeamConfig(workspaceRoot);
  const current = config?.fileTree?.allowPaths ?? [];

  if (current.includes(filePath)) return current;

  const next = [...current, filePath];
  await saveTeamConfig(workspaceRoot, {
    ...DEFAULT_CONFIG,
    ...config,
    fileTree: { ...config?.fileTree, allowPaths: next },
  });
  return next;
}

/**
 * Remove a path from the gitignore allow-list stored in .ai-team/config.json.
 * Returns the updated allow list.
 */
export async function disallowPathCommand(workspaceRoot: string, filePath: string): Promise<string[]> {
  const config = await loadTeamConfig(workspaceRoot);
  const current = config?.fileTree?.allowPaths ?? [];
  const next = current.filter((p) => p !== filePath);

  if (next.length === current.length) return current;

  await saveTeamConfig(workspaceRoot, {
    ...DEFAULT_CONFIG,
    ...config,
    fileTree: { ...config?.fileTree, allowPaths: next },
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
  mode: 'read' | 'write' = 'read'
): Promise<AgentPathResult> {
  const agent = await resolveOneAgent(workspaceRoot, agentQuery);
  const manager = new AgentManager(workspaceRoot);
  await manager.initialize();

  const currentPerms = agent.permissions ?? { read: [], write: [] };
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
  mode: 'read' | 'write' = 'read'
): Promise<AgentPathResult> {
  const agent = await resolveOneAgent(workspaceRoot, agentQuery);
  const manager = new AgentManager(workspaceRoot);
  await manager.initialize();

  const currentPerms = agent.permissions ?? { read: [], write: [] };
  const current: string[] = currentPerms[mode] ?? [];
  const next = current.filter((p) => p !== filePath);

  if (next.length === current.length) return { agent, paths: current };

  const updated = await manager.updateAgent(agent.id, {
    permissions: { ...currentPerms, [mode]: next },
  });
  return { agent: updated, paths: next };
}
