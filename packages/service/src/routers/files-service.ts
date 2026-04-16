import type {
  IPermissionService,
  GetFilePatternsResponse,
  UpdateGlobalPathResponse,
  UpdateAgentPathResponse,
  PathMode,
} from '@ai-team/api-client';
import type { AgentManager } from '@ai-team/infrastructure';
import { loadTeamConfig, loadAgentAccessPatterns } from '@ai-team/infrastructure';
import {
  getFileTreeCommand,
  allowPathCommand,
  disallowPathCommand,
  agentPermissionPathCommand,
  agentDisallowPathCommand,
  permissionAllowCommand,
  permissionDenyCommand,
} from '../commands/file-tree.js';
import { BadRequestError } from '../http-errors.js';

function resolvePathMode(mode: string | undefined): PathMode {
  if (!mode || mode === 'read') return 'read';
  if (mode === 'list') return 'list';
  if (mode === 'write' || mode === 'create' || mode === 'delete') return 'write';
  throw new BadRequestError(`Invalid mode "${mode}". Use one of: read, write, list.`);
}

export class FilesService implements IPermissionService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: AgentManager
  ) {}

  async getPatterns(query?: { agent?: string }): Promise<GetFilePatternsResponse> {
    const config = await loadTeamConfig(this.workspaceRoot);
    const globalPatterns = {
      allowPaths: Array.from(
        new Set([...(config?.fileTree?.readPaths ?? []), ...(config?.fileTree?.writePaths ?? [])])
      ),
      readPaths: config?.fileTree?.readPaths ?? [],
      writePaths: config?.fileTree?.writePaths ?? [],
      listPaths: [] as string[],
    };
    if (!query?.agent) return { global: globalPatterns };
    const matches = await this.agentManager.resolveAgentAsync(query.agent);
    if (matches.length === 0) return { global: globalPatterns };
    const accessPatterns = await loadAgentAccessPatterns(this.workspaceRoot, matches[0].id);
    return {
      global: globalPatterns,
      agent: {
        id: matches[0].id,
        readPaths: accessPatterns.read,
        writePaths: accessPatterns.write,
        listPaths: [],
      },
    };
  }

  async getTree(query?: {
    maxDepth?: number;
    includeHidden?: boolean;
    rootSubPath?: string;
  }): Promise<unknown> {
    return getFileTreeCommand(this.workspaceRoot, {
      maxDepth: query?.maxDepth,
      includeHidden: query?.includeHidden,
      rootSubPath: query?.rootSubPath,
    });
  }

  async allowAll(body: { path: string; mode?: PathMode }): Promise<UpdateGlobalPathResponse> {
    if (!body.path) throw new BadRequestError('"path" is required');
    const mode = resolvePathMode(body.mode);
    const paths = await allowPathCommand(this.workspaceRoot, body.path, mode);
    return { mode, paths };
  }

  async disallowAll(body: { path: string; mode?: PathMode }): Promise<UpdateGlobalPathResponse> {
    if (!body.path) throw new BadRequestError('"path" is required');
    const mode = resolvePathMode(body.mode);
    const paths = await disallowPathCommand(this.workspaceRoot, body.path, mode);
    return { mode, paths };
  }

  async allow(body: {
    agent: string;
    path: string;
    mode?: PathMode;
    requestedBy?: string;
    approvedByUser?: boolean;
  }): Promise<UpdateAgentPathResponse> {
    if (!body.agent || !body.path) throw new BadRequestError('agent and path are required');
    const mode = resolvePathMode(body.mode);
    const result = await agentPermissionPathCommand(
      this.workspaceRoot,
      this.agentManager,
      body.agent,
      body.path,
      mode
    );
    return {
      agent: { id: result.agent.id, name: result.agent.name, role: result.agent.role },
      mode,
      paths: result.paths,
    };
  }

  async disallow(body: {
    agent: string;
    path: string;
    mode?: PathMode;
    requestedBy?: string;
    approvedByUser?: boolean;
  }): Promise<UpdateAgentPathResponse> {
    if (!body.agent || !body.path) throw new BadRequestError('agent and path are required');
    const mode = resolvePathMode(body.mode);
    const result = await agentDisallowPathCommand(
      this.workspaceRoot,
      this.agentManager,
      body.agent,
      body.path,
      mode
    );
    return {
      agent: { id: result.agent.id, name: result.agent.name, role: result.agent.role },
      mode,
      paths: result.paths,
    };
  }

  async permissionAllow(body: {
    agent: string;
    path: string;
    requestedBy?: string;
    approvedByUser?: boolean;
  }): Promise<UpdateAgentPathResponse> {
    if (!body.agent || !body.path) throw new BadRequestError('agent and path are required');
    const result = await permissionAllowCommand(
      this.workspaceRoot,
      this.agentManager,
      body.agent,
      body.path,
      {
        requestedBy: body.requestedBy ?? 'user',
        confirmUserApproval: async () => body.approvedByUser ?? true,
      }
    );
    return {
      agent: { id: result.agent.id, name: result.agent.name, role: result.agent.role },
      mode: 'read',
      paths: result.paths,
    };
  }

  async permissionDeny(body: {
    agent: string;
    path: string;
    requestedBy?: string;
    approvedByUser?: boolean;
  }): Promise<UpdateAgentPathResponse> {
    if (!body.agent || !body.path) throw new BadRequestError('agent and path are required');
    const result = await permissionDenyCommand(
      this.workspaceRoot,
      this.agentManager,
      body.agent,
      body.path,
      {
        requestedBy: body.requestedBy ?? 'user',
        confirmUserApproval: async () => body.approvedByUser ?? true,
      }
    );
    return {
      agent: { id: result.agent.id, name: result.agent.name, role: result.agent.role },
      mode: 'read',
      paths: result.paths,
    };
  }
}
