import {
  type FileTreeNode,
  type GetFileTreeOptions,
  type IFileAnnotationService,
  type IFileTreeService,
  IAgentManager,
  IConfigurationStorage,
  IPermissionStorage,
  Agent,
  TeamConfig,
} from '@ai-team/core';

import type { FilesTreeResponse } from '@ai-team/api-contracts';
import { type GovernanceRequest, GovernanceService } from '../agents/governance.js';

export type PathMode = 'read' | 'write' | 'list';

const DEFAULT_CONFIG: TeamConfig = { version: '1', randomAvatarUrls: [] };

export class FileTreeService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly permissionStorage: IPermissionStorage,
    private readonly governanceService: GovernanceService,
    private readonly fileTreeService?: IFileTreeService,
    private readonly fileAnnotationService?: IFileAnnotationService
  ) {}

  async getFileTree(options: Omit<GetFileTreeOptions, 'allowPaths'> = {}): Promise<FileTreeNode> {
    if (!this.fileTreeService) {
      throw new Error('File tree service is not available.');
    }
    const config = await this.configurationStorage.loadTeamConfigAsync(this.workspaceRoot);
    const allowPaths = Array.from(
      new Set([...(config?.fileTree?.readPaths ?? []), ...(config?.fileTree?.writePaths ?? [])])
    );
    return this.fileTreeService.getCachedFileTree(this.workspaceRoot, { ...options, allowPaths });
  }

  async allowPath(filePath: string, mode: PathMode): Promise<string[]> {
    const config = await this.configurationStorage.loadTeamConfigAsync(this.workspaceRoot);
    const key = mode === 'write' ? 'writePaths' : 'readPaths';
    const current: string[] = (config?.fileTree as any)?.[key] ?? [];

    if (current.includes(filePath)) return current;

    const next = [...current, filePath];
    await this.configurationStorage.saveTeamConfigAsync(this.workspaceRoot, {
      ...DEFAULT_CONFIG,
      ...config,
      fileTree: { readPaths: [], writePaths: [], ...config?.fileTree, [key]: next },
    });
    return next;
  }

  async disallowPath(filePath: string, mode: PathMode): Promise<string[]> {
    const config = await this.configurationStorage.loadTeamConfigAsync(this.workspaceRoot);
    const key = mode === 'write' ? 'writePaths' : 'readPaths';
    const current: string[] = (config?.fileTree as any)?.[key] ?? [];
    const next = current.filter((p) => p !== filePath);

    if (next.length === current.length) return current;

    await this.configurationStorage.saveTeamConfigAsync(this.workspaceRoot, {
      ...DEFAULT_CONFIG,
      ...config,
      fileTree: { readPaths: [], writePaths: [], ...config?.fileTree, [key]: next },
    });
    return next;
  }

  async agentPermissionPath(
    agentQuery: string,
    filePath: string,
    mode: PathMode = 'read'
  ): Promise<AgentPathResult> {
    const agent = await this.resolveOneAgent(agentQuery);
    const permissionPatterns = await this.permissionStorage.loadAsync(agent.id);
    const current = permissionPatterns[mode] ?? [];
    const nextPatterns = current.includes(filePath)
      ? permissionPatterns
      : { ...permissionPatterns, [mode]: [...current, filePath] };
    await this.permissionStorage.saveAsync(agent.id, nextPatterns);
    const updated = await FileTreeService.syncAgentFrontmatterPermissions(agent);
    return { agent: updated, paths: nextPatterns[mode] };
  }

  async permissionAllow(
    agentQuery: string,
    filePath: string,
    governance: GovernanceRequest,
    mode: PathMode = 'read'
  ): Promise<AgentPathResult> {
    const actor = await this.governanceService.resolveGovernanceActor(
      governance.requestedBy,
      'access_allow'
    );
    this.governanceService.assertDefaultGovernancePolicy(actor);
    await this.governanceService.requireUserApproval(
      governance,
      `Approve access_allow by ${actor.name} (${actor.id}) for target agent '${agentQuery}', mode '${mode}', path '${filePath}'?`
    );
    return this.agentPermissionPath(agentQuery, filePath, mode);
  }

  async agentDisallowPath(
    agentQuery: string,
    filePath: string,
    mode: PathMode = 'read'
  ): Promise<AgentPathResult> {
    const agent = await this.resolveOneAgent(agentQuery);
    const accessPatterns = await this.permissionStorage.loadAsync(agent.id);
    const current = accessPatterns[mode] ?? [];
    const next = current.filter((p) => p !== filePath);
    const nextPatterns =
      next.length === current.length ? accessPatterns : { ...accessPatterns, [mode]: next };
    await this.permissionStorage.saveAsync(agent.id, nextPatterns);
    const updated = await FileTreeService.syncAgentFrontmatterPermissions(agent);
    return { agent: updated, paths: nextPatterns[mode] };
  }

  async permissionDeny(
    agentQuery: string,
    filePath: string,
    governance: GovernanceRequest,
    mode: PathMode = 'read'
  ): Promise<AgentPathResult> {
    const actor = await this.governanceService.resolveGovernanceActor(
      governance.requestedBy,
      'access_deny'
    );
    this.governanceService.assertDefaultGovernancePolicy(actor);
    await this.governanceService.requireUserApproval(
      governance,
      `Approve access_deny by ${actor.name} (${actor.id}) for target agent '${agentQuery}', mode '${mode}', path '${filePath}'?`
    );
    return this.agentDisallowPath(agentQuery, filePath, mode);
  }

  async filesTree(payload: {
    agent?: string;
    depth?: number;
    all?: boolean;
    noGitignore?: boolean;
    writeable?: boolean;
  }): Promise<FilesTreeResponse> {
    if (!this.fileTreeService || !this.fileAnnotationService) {
      throw new Error('File tree services are not available.');
    }
    const maxDepth = payload.depth ?? 4;
    const includeHidden = payload.all ?? false;
    const ignoreGitignore = payload.noGitignore ?? false;

    if (payload.agent) {
      const matches = await this.agentManager.resolveAgentAsync(payload.agent);
      if (matches.length === 0) {
        throw new Error(`Agent not found: "${payload.agent}"`);
      }
      const agent = matches[0];
      const tree = await this.getFileTree({
        maxDepth: payload.depth ?? 6,
        includeHidden,
        ignoreGitignore,
      });
      const allFiles = FileTreeService.flattenFiles(tree);
      const accessPatterns = await this.permissionStorage.loadAsync(agent.id);

      if (payload.writeable) {
        const filtered = this.fileAnnotationService.getWritableFiles(
          this.workspaceRoot,
          agent.permissions,
          allFiles
        );
        return {
          workspaceRoot: this.workspaceRoot,
          agent: { id: agent.id, name: agent.name, role: agent.role },
          writeableFiles: filtered,
          writePatterns: accessPatterns.write ?? [],
          maxDepth,
          includeHidden,
          ignoreGitignore,
        };
      }

      const annotated = this.fileAnnotationService.getAnnotatedFiles(
        this.workspaceRoot,
        agent.permissions,
        allFiles
      );
      const withAccess = annotated.filter((f) => f.readable || f.writable);
      return {
        workspaceRoot: this.workspaceRoot,
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

    const tree = await this.getFileTree({ maxDepth, includeHidden, ignoreGitignore });
    return {
      workspaceRoot: this.workspaceRoot,
      tree,
      maxDepth,
      includeHidden,
      ignoreGitignore,
    };
  }

  private async resolveOneAgent(query: string): Promise<Agent> {
    const resolved = await this.agentManager.resolveAgentForOperationAsync(query, 'resolve agent');
    const agent = await this.agentManager.getAgentAsync(resolved.id);
    if (!agent) throw new Error(`Agent not found: "${query}"`);
    return agent;
  }

  private static async syncAgentFrontmatterPermissions(agent: Agent): Promise<Agent> {
    return agent;
  }

  private static flattenFiles(root: FileTreeNode): string[] {
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
}

// ============================================================================
// Per-agent path permissions (stored in .ai-team/agents/<id>.md frontmatter)
// ============================================================================

export interface AgentPathResult {
  agent: Agent;
  /** Updated permission list for the given mode after the operation */
  paths: string[];
}
