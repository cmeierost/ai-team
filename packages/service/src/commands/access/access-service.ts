import {
  checkPathRight,
  resolveWorkspacePathMeta,
  type Agent,
  type IAgentManager,
  type IPathPermissionChecker,
} from '@ai-team/core';
import type {
  FilePermission,
  DoIHavePermissionOptions,
  DoIHavePermissionResponse,
  WhoHasPermissionOptions,
  WhoHasPermissionResponse,
} from '@ai-team/api-contracts';

export class AccessService {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly pathPermissionChecker: IPathPermissionChecker
  ) {}

  async whoHasAccess(options: WhoHasPermissionOptions): Promise<WhoHasPermissionResponse> {
    const workspaceRoot = this.agentManager.workspaceRoot;
    const right: FilePermission = options.right ?? 'list';
    const pathMeta = resolveWorkspacePathMeta(workspaceRoot, options.path);

    if (!pathMeta.insideWorkspace) {
      return {
        path: {
          input: options.path,
          absolute: pathMeta.absolute,
          relative: pathMeta.relative,
        },
        right,
        contextIds: [],
        contexts: [],
        explanation: 'Path is outside workspace root.',
      };
    }

    const agents = await this.agentManager.getAllAgentsAsync();
    const matching = agents.filter((a: Agent) =>
      checkPathRight(
        workspaceRoot,
        this.pathPermissionChecker,
        a.permissions,
        pathMeta.relative,
        right
      )
    );
    const contextIds = matching.map((a: Agent) => a.id);
    const contexts = matching.map((a: Agent) => ({ contextId: a.id, label: a.name }));

    return {
      path: {
        input: options.path,
        absolute: pathMeta.absolute,
        relative: pathMeta.relative,
      },
      right,
      contextIds,
      contexts,
      explanation:
        contextIds.length > 0
          ? `${contextIds.length} agent(s) can access this path with '${right}'.`
          : `No agent can access this path with '${right}'.`,
    };
  }

  async doIHaveAccess(options: DoIHavePermissionOptions): Promise<DoIHavePermissionResponse> {
    const workspaceRoot = this.agentManager.workspaceRoot;
    const right: FilePermission = options.right ?? 'list';
    const pathMeta = resolveWorkspacePathMeta(workspaceRoot, options.path);

    if (!pathMeta.insideWorkspace) {
      return {
        path: {
          input: options.path,
          absolute: pathMeta.absolute,
          relative: pathMeta.relative,
        },
        right,
        contextId: options.agent ?? 'unknown',
        selectedBy: options.agent ? 'explicit' : 'default-first-agent',
        allowed: false,
        allRights: [],
        explanation: 'Path is outside workspace root.',
        alternativeContexts: [],
        deniedByIgnore: false,
        blockedByPatterns: [],
      };
    }

    const agents = await this.agentManager.getAllAgentsAsync();

    let agent: Agent;
    let selectedBy: DoIHavePermissionResponse['selectedBy'];
    if (options.agent && options.agent.trim().length > 0) {
      const resolved = await this.agentManager.resolveAgentForOperationAsync(
        options.agent,
        'check access'
      );
      const found = await this.agentManager.getAgentAsync(resolved.id);
      if (!found) throw new Error(`Agent not found: ${resolved.id}`);
      agent = found;
      selectedBy = 'explicit';
    } else {
      const fallback = [...agents].sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!fallback) throw new Error('No agents available to evaluate access.');
      agent = fallback;
      selectedBy = 'default-first-agent';
    }

    const allowed = checkPathRight(
      workspaceRoot,
      this.pathPermissionChecker,
      agent.permissions,
      pathMeta.relative,
      right
    );
    const allRights: FilePermission[] = [];
    if (
      checkPathRight(
        workspaceRoot,
        this.pathPermissionChecker,
        agent.permissions,
        pathMeta.relative,
        'read'
      )
    )
      allRights.push('read');
    if (
      checkPathRight(
        workspaceRoot,
        this.pathPermissionChecker,
        agent.permissions,
        pathMeta.relative,
        'write'
      )
    )
      allRights.push('write');
    if (
      checkPathRight(
        workspaceRoot,
        this.pathPermissionChecker,
        agent.permissions,
        pathMeta.relative,
        'list'
      )
    )
      allRights.push('list');

    return {
      path: {
        input: options.path,
        absolute: pathMeta.absolute,
        relative: pathMeta.relative,
      },
      right,
      contextId: agent.id,
      contextLabel: agent.name,
      selectedBy,
      allowed,
      allRights,
      explanation: allowed
        ? `Agent '${agent.id}' has ${right} access to '${pathMeta.relative}'.`
        : `Agent '${agent.id}' does not have ${right} access to '${pathMeta.relative}'.`,
      alternativeContexts: [],
      deniedByIgnore: false,
      blockedByPatterns: [],
    };
  }
}
