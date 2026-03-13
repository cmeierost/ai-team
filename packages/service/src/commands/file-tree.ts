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
import {
  type GovernanceRequest,
  assertDefaultGovernancePolicy,
  requireUserApproval,
  resolveGovernanceActor,
} from './governance.js';

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
  agent: Agent,
): Promise<Agent> {
  return agent;
}

/**
 * Add a path to an agent's access pattern file.
 */
export async function agentAllowPathCommand(
  workspaceRoot: string,
  agentQuery: string,
  filePath: string,
  mode: PathMode = 'read'
): Promise<AgentPathResult> {
  const agent = await resolveOneAgent(workspaceRoot, agentQuery);

  const accessPatterns = await loadAgentAccessPatterns(workspaceRoot, agent.id);
  const current = accessPatterns[mode] ?? [];

  const nextPatterns = current.includes(filePath)
    ? accessPatterns
    : { ...accessPatterns, [mode]: [...current, filePath] };

  await saveAgentAccessPatterns(workspaceRoot, agent.id, nextPatterns);
  const updated = await syncAgentFrontmatterPermissions(agent);

  return { agent: updated, paths: nextPatterns[mode] };
}

/**
 * Alias for agentAllowPathCommand using governance naming.
 */
export async function accessAllowCommand(
  workspaceRoot: string,
  agentQuery: string,
  filePath: string,
  governance: GovernanceRequest,
  mode: PathMode = 'read',
): Promise<AgentPathResult> {
  const actor = await resolveGovernanceActor(workspaceRoot, governance.requestedBy, 'access_allow');
  assertDefaultGovernancePolicy(actor);
  await requireUserApproval(
    governance,
    `Approve access_allow by ${actor.name} (${actor.id}) for target agent '${agentQuery}', mode '${mode}', path '${filePath}'?`,
  );

  return agentAllowPathCommand(workspaceRoot, agentQuery, filePath, mode);
}

/**
 * Remove a path from an agent's access pattern file.
 */
export async function agentDisallowPathCommand(
  workspaceRoot: string,
  agentQuery: string,
  filePath: string,
  mode: PathMode = 'read'
): Promise<AgentPathResult> {
  const agent = await resolveOneAgent(workspaceRoot, agentQuery);

  const accessPatterns = await loadAgentAccessPatterns(workspaceRoot, agent.id);
  const current = accessPatterns[mode] ?? [];
  const next = current.filter((p) => p !== filePath);

  const nextPatterns = next.length === current.length
    ? accessPatterns
    : { ...accessPatterns, [mode]: next };

  await saveAgentAccessPatterns(workspaceRoot, agent.id, nextPatterns);
  const updated = await syncAgentFrontmatterPermissions(agent);

  return { agent: updated, paths: nextPatterns[mode] };
}

/**
 * Alias for agentDisallowPathCommand using governance naming.
 */
export async function accessDenyCommand(
  workspaceRoot: string,
  agentQuery: string,
  filePath: string,
  governance: GovernanceRequest,
  mode: PathMode = 'read',
): Promise<AgentPathResult> {
  const actor = await resolveGovernanceActor(workspaceRoot, governance.requestedBy, 'access_deny');
  assertDefaultGovernancePolicy(actor);
  await requireUserApproval(
    governance,
    `Approve access_deny by ${actor.name} (${actor.id}) for target agent '${agentQuery}', mode '${mode}', path '${filePath}'?`,
  );

  return agentDisallowPathCommand(workspaceRoot, agentQuery, filePath, mode);
}
