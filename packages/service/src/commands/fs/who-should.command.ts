import { z } from 'zod';
import type {
  FindCapableAgentResult,
  ICommand,
  Agent,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { IAgentRegistry, IToolCatalog } from '../orchestration/orchestration.types.js';

type Params = z.infer<typeof WhoShouldCommand.schema>;
const _whoShouldCommandSchema = z.object({
  task: z.string().min(1).describe('Natural language description of the task'),
  requiredTool: z
    .string()
    .optional()
    .describe('Tool name that must be available (e.g. write_file)'),
  requiredArgs: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Arguments for requiredTool — used for permission checking'),
});

export const WhoShouldCommandMetadata = {
  key: 'who_should',
  description:
    'Discover which team members are authorized to perform a specific action. ' +
    'Call this before com_handoff to ensure you delegate to the right person.',
  availableIn: { tool: true },
  group: 'fs',
  parameters: _whoShouldCommandSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration'],
} satisfies ICommandDescriptor;

export class WhoShouldCommand implements ICommand<Params, FindCapableAgentResult> {
  static readonly schema = _whoShouldCommandSchema;
  readonly metadata = WhoShouldCommandMetadata;

  constructor(
    private readonly agents: IAgentRegistry,
    private readonly tools: IToolCatalog
  ) {}

  async execute(
    params: Params,
    _context: ExecutionContext
  ): Promise<CommandResponse<FindCapableAgentResult>> {
    const { task, requiredTool, requiredArgs } = params;

    const allAgents = await this.agents.getAllAgentsAsync();

    const matched: Agent[] = requiredTool
      ? await this.tools.whoCanExecute(requiredTool, requiredArgs ?? {}, allAgents)
      : allAgents;

    return {
      status: 'ok',
      data: {
        type: 'fs_who_should_result',
        task,
        matches: matched.map((a) => ({ agentId: a.id, agentName: a.name, agentRole: a.role })),
        timestamp: new Date().toISOString(),
      },
    };
  }
}
