import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  IAgentManager,
  IPathPermissionChecker,
  Agent,
  ICommandDescriptor,
} from '@ai-team/core';
import type { DoIHavePermissionResponse } from '@ai-team/api-contracts';
import { resolveWorkspacePathMeta } from '../fs/fs-access.js';

type Params = z.infer<typeof AccessCanCommand.schema>;
const _accessCanCommandSchema = z.object({
  path: z.string().describe('Path to evaluate'),
  right: z.enum(['read', 'write', 'list']).default('list').describe('Right to evaluate'),
  agent: z.string().optional().describe('Optional agent query override'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const AccessCanCommandMetadata = {
  key: 'can',
  description: 'Check whether a context/agent can access a path for a right',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'access',
  parameters: _accessCanCommandSchema,
} satisfies ICommandDescriptor;

export class AccessCanCommand implements ICommand<Params, DoIHavePermissionResponse> {
  static readonly schema = _accessCanCommandSchema;
  readonly metadata = AccessCanCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly pathPermissionChecker: IPathPermissionChecker
  ) {}

  async execute(
    payload: Params,
    ctx: ExecutionContext
  ): Promise<CommandResponse<DoIHavePermissionResponse>> {
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
          contextId: payload.agent ?? ctx.agent?.id ?? '',
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

    const allowed = this.pathPermissionChecker.can(right, agent.permissions, pathMeta.relative);
    const allRights: DoIHavePermissionResponse['allRights'] = [];
    if (this.pathPermissionChecker.can('read', agent.permissions, pathMeta.relative))
      allRights.push('read');
    if (this.pathPermissionChecker.can('write', agent.permissions, pathMeta.relative))
      allRights.push('write');
    if (this.pathPermissionChecker.can('list', agent.permissions, pathMeta.relative))
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
