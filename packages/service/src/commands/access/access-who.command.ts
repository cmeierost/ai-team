import { z } from 'zod';
import type {
  ICommand,
  CommandResponse,
  IAgentManager,
  IPathPermissionChecker,
  Agent,
  ICommandDescriptor,
} from '@ai-team/core';
import { checkPathRight, resolveWorkspacePathMeta } from '@ai-team/core';
import type { WhoHasPermissionResponse } from '@ai-team/api-contracts';

type Params = z.infer<typeof AccessWhoCommand.schema>;
const schema = z.object({
  path: z.string().describe('Path to evaluate'),
  right: z.enum(['read', 'write', 'list']).optional().describe('Right to evaluate'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const AccessWhoCommandMetadata = {
  key: 'who',
  description: 'Show which contexts/agents can access a path for a right',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'access',
  parameters: schema,
} satisfies ICommandDescriptor;

export class AccessWhoCommand implements ICommand<Params, WhoHasPermissionResponse> {
  static readonly schema = schema;
  readonly metadata = AccessWhoCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly pathPermissionChecker: IPathPermissionChecker
  ) {}

  async execute(payload: Params): Promise<CommandResponse<WhoHasPermissionResponse>> {
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
          input: payload.path,
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
