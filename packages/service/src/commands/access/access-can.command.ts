import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  IAgentManager,
  IPathPermissionChecker,
  Agent,
} from '@ai-team/core';
import { checkPathRight, resolveWorkspacePathMeta } from '@ai-team/core';
import type { DoIHavePermissionResponse } from '@ai-team/api-contracts';

type Params = z.infer<typeof AccessCanCommand.schema>;

export class AccessCanCommand implements ICommand<Params, DoIHavePermissionResponse> {
  static readonly schema = z.object({
    path: z.string().describe('Path to evaluate'),
    right: z.enum(['read', 'write', 'list']).default('list').describe('Right to evaluate'),
    agent: z.string().optional().describe('Optional agent query override'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'accessCan';
  readonly cli = { command: 'can', parentKey: 'access' };
  readonly description = 'Check whether a context/agent can access a path for a right';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'access';
  readonly parameters = AccessCanCommand.schema;

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly pathPermissionChecker: IPathPermissionChecker
  ) {}

  async execute(
    payload: Params,
    ctx: ExecutionContext
  ): Promise<CommandResponse<DoIHavePermissionResponse>> {
    const agentQuery = payload.agent ?? ctx.agent?.id;
    if (!agentQuery) {
      return {
        status: 'error',
        message: 'No agent specified',
        error: { code: 'AGENT_NOT_FOUND', message: 'No agent specified' },
      };
    }
    const right = payload.right ?? 'list';
    const pathMeta = resolveWorkspacePathMeta(this.workspaceRoot, payload.path);

    if (!pathMeta.insideWorkspace) {
      return {
        status: 'ok',
        data: {
          path: {
            input: payload.path,
            absolute: pathMeta.absolute,
            relative: pathMeta.relative,
          },
          right,
          contextId: agentQuery,
          selectedBy: payload.agent ? 'explicit' : 'default-first-agent',
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
    if (payload.agent && payload.agent.trim().length > 0) {
      const resolved = await this.agentManager.resolveAgentForOperationAsync(
        payload.agent,
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
          input: payload.path,
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
