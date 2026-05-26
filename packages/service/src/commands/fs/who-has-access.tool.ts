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
import type { WhoHasPermissionResponse } from '@ai-team/api-contracts';
import { accessRightSchema, type AccessRight } from './fs-access.js';

export interface WhoHasAccessParams {
  path: string;
  right?: AccessRight;
}

export type WhoHasAccessResult = WhoHasPermissionResponse;
export const WhoHasAccessToolMetadata = {
  key: 'who_can',
  group: 'access',
  availableIn: { tool: true },
  description: 'Show which agents can access a path for a given right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
  }),
} satisfies ICommandDescriptor;

export class WhoHasAccessTool implements ICommand<WhoHasAccessParams, WhoHasAccessResult> {
  readonly metadata = WhoHasAccessToolMetadata;
  readonly name = 'who_can';

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly pathPermissionChecker: IPathPermissionChecker
  ) {}

  async execute(
    params: WhoHasAccessParams,
    context: ExecutionContext
  ): Promise<CommandResponse<WhoHasAccessResult>> {
    const { path: targetPath, right = 'list' } = params;
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
          contextIds: [],
          contexts: [],
          explanation: 'Path is outside workspace root.',
        },
      };
    }

    const agents = await this.agentManager.getAllAgentsAsync();
    const matching = agents.filter((a: Agent) =>
      checkPathRight(this.pathPermissionChecker, a.permissions, pathMeta.relative, right)
    );
    const contextIds = matching.map((a: Agent) => a.id);
    const contexts = matching.map((a: Agent) => ({ contextId: a.id, label: a.name }));

    return {
      status: 'ok',
      data: {
        path: {
          input: targetPath,
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
      },
    };
  }
}
