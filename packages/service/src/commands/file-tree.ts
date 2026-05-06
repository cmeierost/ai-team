import {
  type FileTreeNode,
  type GetFileTreeOptions,
  type IFileAnnotationService,
  type IFileTreeService,
} from '@ai-team/core';
import type {
  IAgentManager,
  IConfigurationStorage,
  IPermissionStorage,
  Agent,
  TeamConfig,
} from '@ai-team/core';
import type { FilesTreeResponse } from '@ai-team/api-contracts';
import { resolveAgentForOperationAsync } from '../utils/agent-resolution.js';
import {
  type GovernanceRequest,
  assertDefaultGovernancePolicy,
  requireUserApproval,
  resolveGovernanceActor,
} from './governance.js';

type PathMode = 'read' | 'write' | 'list';

const DEFAULT_CONFIG: TeamConfig = { version: '1', randomAvatarUrls: [] };

export class FileTreeCommand {
  private readonly workspaceRoot: string;

  constructor(
    private readonly agentManager: IAgentManager,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly permissionStorage: IPermissionStorage,
    private readonly fileTreeService: IFileTreeService,
    private readonly fileAnnotationService: IFileAnnotationService
  ) {
    this.workspaceRoot = agentManager.workspaceRoot;
  }

  async getFileTree(options: Omit<GetFileTreeOptions, 'allowPaths'> = {}): Promise<FileTreeNode> {
    return getFileTreeCommand(
      this.workspaceRoot,
      this.configurationStorage,
      this.fileTreeService,
      options
    );
  }

  async allowPath(filePath: string, mode: PathMode): Promise<string[]> {
    return allowPathCommand(this.workspaceRoot, this.configurationStorage, filePath, mode);
  }

  async disallowPath(filePath: string, mode: PathMode): Promise<string[]> {
    return disallowPathCommand(this.workspaceRoot, this.configurationStorage, filePath, mode);
  }

  async agentPermissionPath(
    agentQuery: string,
    filePath: string,
    mode: PathMode = 'read'
  ): Promise<AgentPathResult> {
    return agentPermissionPathCommand(
      this.workspaceRoot,
      this.agentManager,
      this.permissionStorage,
      agentQuery,
      filePath,
      mode
    );
  }

  async permissionAllow(
    agentQuery: string,
    filePath: string,
    governance: GovernanceRequest,
    mode: PathMode = 'read'
  ): Promise<AgentPathResult> {
    return permissionAllowCommand(
      this.workspaceRoot,
      this.agentManager,
      this.permissionStorage,
      agentQuery,
      filePath,
      governance,
      mode
    );
  }

  async agentDisallowPath(
    agentQuery: string,
    filePath: string,
    mode: PathMode = 'read'
  ): Promise<AgentPathResult> {
    return agentDisallowPathCommand(
      this.workspaceRoot,
      this.agentManager,
      this.permissionStorage,
      agentQuery,
      filePath,
      mode
    );
  }

  async permissionDeny(
    agentQuery: string,
    filePath: string,
    governance: GovernanceRequest,
    mode: PathMode = 'read'
  ): Promise<AgentPathResult> {
    return permissionDenyCommand(
      this.workspaceRoot,
      this.agentManager,
      this.permissionStorage,
      agentQuery,
      filePath,
      governance,
      mode
    );
  }

  async filesTree(payload: {
    agent?: string;
    depth?: number;
    all?: boolean;
    noGitignore?: boolean;
    writeable?: boolean;
  }): Promise<FilesTreeResponse> {
    return filesTreeCommandAsync(
      this.workspaceRoot,
      this.agentManager,
      this.configurationStorage,
      this.permissionStorage,
      this.fileTreeService,
      this.fileAnnotationService,
      payload
    );
  }
}

/**
 * Return the workspace file tree using global read/write patterns as visibility overrides
 * for gitignored files/directories.
 */
export async function getFileTreeCommand(
  workspaceRoot: string,
  configurationStorage: IConfigurationStorage,
  fileTreeService: IFileTreeService,
  options: Omit<GetFileTreeOptions, 'allowPaths'> = {}
): Promise<FileTreeNode> {
  const config = await configurationStorage.loadTeamConfigAsync(workspaceRoot);
  const allowPaths = Array.from(
    new Set([...(config?.fileTree?.readPaths ?? []), ...(config?.fileTree?.writePaths ?? [])])
  );
  return fileTreeService.getCachedFileTree(workspaceRoot, { ...options, allowPaths });
}

/**
 * Add a path to the global read or write permission list in .ai-team/config.json.
 * Returns the updated path list for the selected mode.
 */
export async function allowPathCommand(
  workspaceRoot: string,
  configurationStorage: IConfigurationStorage,
  filePath: string,
  mode: PathMode
): Promise<string[]> {
  const config = await configurationStorage.loadTeamConfigAsync(workspaceRoot);
  const key = mode === 'write' ? 'writePaths' : 'readPaths';
  const current: string[] = (config?.fileTree as any)?.[key] ?? [];

  if (current.includes(filePath)) return current;

  const next = [...current, filePath];
  await configurationStorage.saveTeamConfigAsync(workspaceRoot, {
    ...DEFAULT_CONFIG,
    ...config,
    fileTree: { readPaths: [], writePaths: [], ...config?.fileTree, [key]: next },
  });
  return next;
}

/**
 * Remove a path from the global read or write permission list in .ai-team/config.json.
 * Returns the updated path list for the selected mode.
 */
export async function disallowPathCommand(
  workspaceRoot: string,
  configurationStorage: IConfigurationStorage,
  filePath: string,
  mode: PathMode
): Promise<string[]> {
  const config = await configurationStorage.loadTeamConfigAsync(workspaceRoot);
  const key = mode === 'write' ? 'writePaths' : 'readPaths';
  const current: string[] = (config?.fileTree as any)?.[key] ?? [];
  const next = current.filter((p) => p !== filePath);

  if (next.length === current.length) return current;

  await configurationStorage.saveTeamConfigAsync(workspaceRoot, {
    ...DEFAULT_CONFIG,
    ...config,
    fileTree: { readPaths: [], writePaths: [], ...config?.fileTree, [key]: next },
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

async function resolveOneAgentAsync(agentManager: IAgentManager, query: string): Promise<Agent> {
  const resolved = await resolveAgentForOperationAsync(agentManager, query, 'resolve agent');
  const agent = await agentManager.getAgentAsync(resolved.id);
  if (!agent) throw new Error(`Agent not found: "${query}"`);
  return agent;
}

async function syncAgentFrontmatterPermissions(agent: Agent): Promise<Agent> {
  return agent;
}

/**
 * Add a path to an agent's access pattern file.
 */
export async function agentPermissionPathCommand(
  workspaceRoot: string,
  agentManager: IAgentManager,
  permissionStorage: IPermissionStorage,
  agentQuery: string,
  filePath: string,
  mode: PathMode = 'read'
): Promise<AgentPathResult> {
  const agent = await resolveOneAgentAsync(agentManager, agentQuery);

  const permissionPatterns = await permissionStorage.loadAsync(agent.id);
  const current = permissionPatterns[mode] ?? [];

  const nextPatterns = current.includes(filePath)
    ? permissionPatterns
    : { ...permissionPatterns, [mode]: [...current, filePath] };

  await permissionStorage.saveAsync(agent.id, nextPatterns);
  const updated = await syncAgentFrontmatterPermissions(agent);

  return { agent: updated, paths: nextPatterns[mode] };
}

/**
 * Alias for agentPermissionPathCommand using governance naming.
 */
export async function permissionAllowCommand(
  workspaceRoot: string,
  agentManager: IAgentManager,
  permissionStorage: IPermissionStorage,
  agentQuery: string,
  filePath: string,
  governance: GovernanceRequest,
  mode: PathMode = 'read'
): Promise<AgentPathResult> {
  const actor = await resolveGovernanceActor(agentManager, governance.requestedBy, 'access_allow');
  assertDefaultGovernancePolicy(actor);
  await requireUserApproval(
    governance,
    `Approve access_allow by ${actor.name} (${actor.id}) for target agent '${agentQuery}', mode '${mode}', path '${filePath}'?`
  );

  return agentPermissionPathCommand(
    workspaceRoot,
    agentManager,
    permissionStorage,
    agentQuery,
    filePath,
    mode
  );
}

/**
 * Remove a path from an agent's access pattern file.
 */
export async function agentDisallowPathCommand(
  workspaceRoot: string,
  agentManager: IAgentManager,
  permissionStorage: IPermissionStorage,
  agentQuery: string,
  filePath: string,
  mode: PathMode = 'read'
): Promise<AgentPathResult> {
  const agent = await resolveOneAgentAsync(agentManager, agentQuery);

  const accessPatterns = await permissionStorage.loadAsync(agent.id);
  const current = accessPatterns[mode] ?? [];
  const next = current.filter((p) => p !== filePath);

  const nextPatterns =
    next.length === current.length ? accessPatterns : { ...accessPatterns, [mode]: next };

  await permissionStorage.saveAsync(agent.id, nextPatterns);
  const updated = await syncAgentFrontmatterPermissions(agent);

  return { agent: updated, paths: nextPatterns[mode] };
}

/**
 * Alias for agentDisallowPathCommand using governance naming.
 */
export async function permissionDenyCommand(
  workspaceRoot: string,
  agentManager: IAgentManager,
  permissionStorage: IPermissionStorage,
  agentQuery: string,
  filePath: string,
  governance: GovernanceRequest,
  mode: PathMode = 'read'
): Promise<AgentPathResult> {
  const actor = await resolveGovernanceActor(agentManager, governance.requestedBy, 'access_deny');
  assertDefaultGovernancePolicy(actor);
  await requireUserApproval(
    governance,
    `Approve access_deny by ${actor.name} (${actor.id}) for target agent '${agentQuery}', mode '${mode}', path '${filePath}'?`
  );

  return agentDisallowPathCommand(
    workspaceRoot,
    agentManager,
    permissionStorage,
    agentQuery,
    filePath,
    mode
  );
}

// ============================================================================
// Full file tree / patterns data commands for CLI + browser renderers
// ============================================================================

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

async function filesTreeCommandAsync(
  workspaceRoot: string,
  agentManager: IAgentManager,
  configurationStorage: IConfigurationStorage,
  permissionStorage: IPermissionStorage,
  fileTreeService: IFileTreeService,
  fileAnnotationService: IFileAnnotationService,
  payload: {
    agent?: string;
    depth?: number;
    all?: boolean;
    noGitignore?: boolean;
    writeable?: boolean;
  }
): Promise<FilesTreeResponse> {
  const maxDepth = payload.depth ?? 4;
  const includeHidden = payload.all ?? false;
  const ignoreGitignore = payload.noGitignore ?? false;

  if (payload.agent) {
    const matches = await agentManager.resolveAgentAsync(payload.agent);
    if (matches.length === 0) {
      throw new Error(`Agent not found: "${payload.agent}"`);
    }
    const agent = matches[0];

    const tree = await getFileTreeCommand(workspaceRoot, configurationStorage, fileTreeService, {
      maxDepth: payload.depth ?? 6,
      includeHidden,
      ignoreGitignore,
    });
    const allFiles = flattenFiles(tree);
    const accessPatterns = await permissionStorage.loadAsync(agent.id);
    if (payload.writeable) {
      const filtered = fileAnnotationService.getWritableFiles(
        workspaceRoot,
        agent.permissions,
        allFiles
      );
      return {
        workspaceRoot,
        agent: { id: agent.id, name: agent.name, role: agent.role },
        writeableFiles: filtered,
        writePatterns: accessPatterns.write ?? [],
        maxDepth,
        includeHidden,
        ignoreGitignore,
      };
    }

    const annotated = fileAnnotationService.getAnnotatedFiles(
      workspaceRoot,
      agent.permissions,
      allFiles
    );
    const withAccess = annotated.filter((f) => f.readable || f.writable);

    return {
      workspaceRoot,
      agent: { id: agent.id, name: agent.name, role: agent.role },
      annotatedFiles: withAccess.map((f) => ({
        path: f.path,
        readable: f.readable,
        writable: f.writable,
      })),
      readPatterns: accessPatterns.read ?? [],
      writePatterns: accessPatterns.write ?? [],
      maxDepth,
      includeHidden,
      ignoreGitignore,
    };
  }

  const tree = await getFileTreeCommand(workspaceRoot, configurationStorage, fileTreeService, {
    maxDepth,
    includeHidden,
    ignoreGitignore,
  });

  return {
    workspaceRoot,
    tree,
    maxDepth,
    includeHidden,
    ignoreGitignore,
  };
}
