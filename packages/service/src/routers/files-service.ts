import type {
  IPermissionService,
  GetFilePatternsResponse,
  UpdateGlobalPathResponse,
  UpdateAgentPathResponse,
  PathMode,
} from '@ai-team/api-contracts';
import type {
  IAgentManager,
  IPermissionStorage,
} from '@ai-team/core';
import { FileTreeService } from '../commands/fs/file-tree.js';
import { BadRequestError } from '@ai-team/core';

function resolvePathMode(mode: string | undefined): PathMode {
  if (!mode || mode === 'read') return 'read';
  if (mode === 'list') return 'list';
  if (mode === 'write' || mode === 'create' || mode === 'delete') return 'write';
  throw new BadRequestError(`Invalid mode "${mode}". Use one of: read, write, list.`);
}

export class FilesService implements IPermissionService {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly fileTree: { readPaths?: string[]; writePaths?: string[] },
    private readonly permRegistry: IPermissionStorage,
    private readonly fileTreeAccessService: FileTreeService
  ) {}

  async getPatterns(query?: { agent?: string }): Promise<GetFilePatternsResponse> {
    const globalPatterns = {
      allowPaths: Array.from(
        new Set([...(this.fileTree?.readPaths ?? []), ...(this.fileTree?.writePaths ?? [])])
      ),
      readPaths: this.fileTree?.readPaths ?? [],
      writePaths: this.fileTree?.writePaths ?? [],
      listPaths: [] as string[],
    };
    if (!query?.agent) return { global: globalPatterns };
    const matches = await this.agentManager.resolveAgentAsync(query.agent);
    if (matches.length === 0) return { global: globalPatterns };
    const accessPatterns = await this.permRegistry.loadAsync(matches[0].id);
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
    return this.fileTreeAccessService.getFileTree({
      maxDepth: query?.maxDepth,
      includeHidden: query?.includeHidden,
      rootSubPath: query?.rootSubPath,
    });
  }

  async allowAll(body: { path: string; mode?: PathMode }): Promise<UpdateGlobalPathResponse> {
    if (!body.path) throw new BadRequestError('"path" is required');
    const mode = resolvePathMode(body.mode);
    const paths = await this.fileTreeAccessService.allowPath(body.path, mode);
    return { mode, paths };
  }

  async disallowAll(body: { path: string; mode?: PathMode }): Promise<UpdateGlobalPathResponse> {
    if (!body.path) throw new BadRequestError('"path" is required');
    const mode = resolvePathMode(body.mode);
    const paths = await this.fileTreeAccessService.disallowPath(body.path, mode);
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
    const result = await this.fileTreeAccessService.agentPermissionPath(body.agent, body.path, mode);
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
    const result = await this.fileTreeAccessService.agentDisallowPath(body.agent, body.path, mode);
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
    const result = await this.fileTreeAccessService.permissionAllow(body.agent, body.path, {
      requestedBy: body.requestedBy ?? 'user',
      confirmUserApproval: async () => body.approvedByUser ?? true,
    });
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
    const result = await this.fileTreeAccessService.permissionDeny(body.agent, body.path, {
      requestedBy: body.requestedBy ?? 'user',
      confirmUserApproval: async () => body.approvedByUser ?? true,
    });
    return {
      agent: { id: result.agent.id, name: result.agent.name, role: result.agent.role },
      mode: 'read',
      paths: result.paths,
    };
  }
}
