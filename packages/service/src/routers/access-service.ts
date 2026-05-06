import path from 'node:path';
import type {
  IAccessService,
  WhoHasPermissionResponse,
  DoIHavePermissionResponse,
  PermissionOverlapReport,
  FilePermission,
} from '@ai-team/api-contracts';
import { ContextRuntime, listCachedWorkspaceFiles } from 'fs-context';
import { IAgentManager } from '@ai-team/core';
import {
  InfrastructureWorkspaceAccessRuntime,
  type IWorkspaceAccessRuntime,
} from '../runtime/infrastructure-adapters.js';

export class AccessService implements IAccessService {
  #populatePromise: Promise<void> | null = null;

  constructor(
    private readonly ctx: ContextRuntime,
    private readonly agentManager: IAgentManager,
    private readonly accessRuntime: IWorkspaceAccessRuntime = new InfrastructureWorkspaceAccessRuntime()
  ) {}

  private ensurePopulatedAsync(): Promise<void> {
    if (!this.#populatePromise) {
      this.#populatePromise = this.#populateAsync();
    }
    return this.#populatePromise;
  }

  async #populateAsync(): Promise<void> {
    const workspaceRoot = this.agentManager.workspaceRoot;
    const [agents, entries] = await Promise.all([
      this.agentManager.getAllAgentsAsync(),
      listCachedWorkspaceFiles(workspaceRoot),
    ]);
    const allFiles = entries.map((e) => e.relativePath);
    for (const agent of agents) {
      const single = await this.accessRuntime.createAgentRuntime(
        agent.id,
        workspaceRoot,
        agent.permissions,
        allFiles
      );
      const resolved = single.getResolved(agent.id);
      if (resolved) {
        this.ctx.register(agent.id, resolved);
      }
    }
  }

  async whoHasPermission(query: {
    path: string;
    right: string;
  }): Promise<WhoHasPermissionResponse> {
    await this.ensurePopulatedAsync();
    const right = query.right as FilePermission;

    let contextIds: string[];
    if (right === 'write') {
      contextIds = this.ctx.contextsThatCanWrite(query.path);
    } else if (right === 'list') {
      contextIds = this.ctx.contextsThatCanList(query.path);
    } else {
      contextIds = this.ctx.contextsThatCanRead(query.path);
    }

    const workspaceRoot = this.agentManager.workspaceRoot;
    const absolute = path.resolve(workspaceRoot, query.path);
    const relative = path.relative(workspaceRoot, absolute);

    const contexts = await Promise.all(
      contextIds.map(async (contextId) => {
        const agent = await this.agentManager.getAgentAsync(contextId);
        return { contextId, label: agent?.name };
      })
    );

    const explanation =
      contextIds.length === 0
        ? `No agent has ${right} permission for "${query.path}".`
        : `${contextIds.length} agent(s) have ${right} permission for "${query.path}".`;

    return {
      path: { input: query.path, absolute, relative },
      right,
      contextIds,
      contexts,
      explanation,
    };
  }

  async doIHavePermission(query: {
    path: string;
    right: string;
    agent: string;
  }): Promise<DoIHavePermissionResponse> {
    await this.ensurePopulatedAsync();
    const right = query.right as FilePermission;
    const contextId = query.agent;

    let allowed: boolean;
    if (right === 'write') {
      allowed = this.ctx.canWrite(contextId, query.path);
    } else if (right === 'list') {
      allowed = this.ctx.canList(contextId, query.path);
    } else {
      allowed = this.ctx.canRead(contextId, query.path);
    }

    const workspaceRoot = this.agentManager.workspaceRoot;
    const absolute = path.resolve(workspaceRoot, query.path);
    const relative = path.relative(workspaceRoot, absolute);

    const agent = await this.agentManager.getAgentAsync(contextId);

    const allRights: FilePermission[] = [];
    if (this.ctx.canRead(contextId, query.path)) allRights.push('read');
    if (this.ctx.canWrite(contextId, query.path)) allRights.push('write');
    if (this.ctx.canList(contextId, query.path)) allRights.push('list');

    const { alternatives } = this.ctx.suggestBestContextForPath(query.path, right as any);
    const alternativeContexts = alternatives.map((altContextId) => ({
      contextId: altContextId,
      allowedPaths: [query.path],
    }));

    const explanation = allowed
      ? `Agent "${contextId}" has ${right} permission for "${query.path}".`
      : `Agent "${contextId}" does not have ${right} permission for "${query.path}".`;

    return {
      path: { input: query.path, absolute, relative },
      right,
      contextId,
      contextLabel: agent?.name,
      selectedBy: 'explicit',
      allowed,
      allRights,
      explanation,
      alternativeContexts,
      deniedByIgnore: false,
      blockedByPatterns: [],
    };
  }

  async analyzeOverlap(query?: {
    mode?: string;
    agent?: string;
    maxDepth?: number;
  }): Promise<PermissionOverlapReport> {
    const result = await this.accessRuntime.analyzeWorkspacePermissionOverlapAsync(
      this.agentManager.workspaceRoot,
      {
        mode: query?.mode as any,
        agentId: query?.agent,
        maxDepth: query?.maxDepth,
      }
    );
    return result as unknown as PermissionOverlapReport;
  }
}
