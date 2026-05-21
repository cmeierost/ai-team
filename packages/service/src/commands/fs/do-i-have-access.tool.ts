import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IAgentManager,
  IPathPermissionChecker,
  Agent,
  ICommandDescriptor,
} from '@ai-team/core';
import { checkPathRight, resolveWorkspacePathMeta } from '@ai-team/core';
import type { DoIHavePermissionResponse } from '@ai-team/api-contracts';
import { accessRightSchema, type AccessRight } from './fs-access.js';

export interface DoIHaveAccessParams {
  path: string;
  right?: AccessRight;
  agentId?: string;
}

export type DoIHaveAccessResult = DoIHavePermissionResponse;
export const DoIHaveAccessToolMetadata = {
  key: 'can_i',
  group: 'access',
  availableIn: { tool: true },
  description: 'Check whether the current agent (or an explicit agent) has access to a path/right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
    agentId: z
      .string()
      .optional()
      .describe('Optional agent ID override (defaults to current agent)'),
  }),
} satisfies ICommandDescriptor;

export class DoIHaveAccessTool implements ICommand<DoIHaveAccessParams, DoIHaveAccessResult> {
  readonly metadata = DoIHaveAccessToolMetadata;
  readonly name = 'can_i';

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly pathPermissionChecker: IPathPermissionChecker
  ) {}

  async execute(
    params: DoIHaveAccessParams,
    context: ExecutionContext
  ): Promise<CommandResponse<DoIHaveAccessResult>> {
    const { path: targetPath, right = 'list', agentId } = params;
    const pathMeta = resolveWorkspacePathMeta(this.workspaceRoot, targetPath);

    if (!pathMeta.insideWorkspace) {
      return {
        status: 'ok',
        data: {
          path: {
            input: targetPath,
            absolute: pathMeta.absolute,
            relative: pathMeta.relative,
          },
          right,
          contextId: agentId ?? context.agent?.id ?? 'unknown',
          selectedBy: agentId ? 'explicit' : 'default-first-agent',
          allowed: false,
          allRights: [],
          explanation: 'Path is outside workspace root.',
          alternativeContexts: [],
          deniedByIgnore: false,
          blockedByPatterns: [],
        },
      };
    }

    const agents = await this.agentManager.getAllAgentsAsync();
    let agent: Agent;
    let selectedBy: DoIHavePermissionResponse['selectedBy'];
    if (agentId && agentId.trim().length > 0) {
      const resolved = await this.agentManager.resolveAgentForOperationAsync(
        agentId,
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
      this.pathPermissionChecker,
      agent.permissions,
      pathMeta.relative,
      right
    );
    const allRights: DoIHavePermissionResponse['allRights'] = [];
    if (checkPathRight(this.pathPermissionChecker, agent.permissions, pathMeta.relative, 'read'))
      allRights.push('read');
    if (checkPathRight(this.pathPermissionChecker, agent.permissions, pathMeta.relative, 'write'))
      allRights.push('write');
    if (checkPathRight(this.pathPermissionChecker, agent.permissions, pathMeta.relative, 'list'))
      allRights.push('list');

    return {
      status: 'ok',
      data: {
        path: {
          input: targetPath,
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
      },
    };
  }
}
