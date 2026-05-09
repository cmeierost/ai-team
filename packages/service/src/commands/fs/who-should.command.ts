import { z } from 'zod';
import type {
  CommandRuntime,
  FindCapableAgentResult,
  ICommand,
  ToolContext,
  Agent,
} from '@ai-team/core';
import type { IAgentRegistry, IToolCatalog } from '../orchestration/orchestration.types.js';

type Params = z.infer<typeof WhoShouldCommand.schema>;

export class WhoShouldCommand implements ICommand<Params, ToolContext, FindCapableAgentResult> {
  static readonly schema = z.object({
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

  readonly key = 'who_should';
  readonly description =
    'Discover which team members are authorized to perform a specific action. ' +
    'Call this before com_handoff to ensure you delegate to the right person.';
  readonly availableIn = { tool: true };
  readonly group = 'fs';
  readonly parameters = WhoShouldCommand.schema;
  readonly permissionCheck = { type: 'none' as const };
  readonly tags = ['orchestration'];

  constructor(
    private readonly agents: IAgentRegistry,
    private readonly tools: IToolCatalog
  ) {}

  async execute(params: Params, _context: ToolContext, _runtime: CommandRuntime): Promise<FindCapableAgentResult> {
    const { task, requiredTool, requiredArgs } = params;

    const allAgents = await this.agents.getAllAgentsAsync();

    const matched: Agent[] = requiredTool
      ? await this.tools.whoCanExecute(requiredTool, requiredArgs ?? {}, allAgents)
      : allAgents;

    return {
      type: 'fs_who_should_result',
      task,
      matches: matched.map((a) => ({ agentId: a.id, agentName: a.name, agentRole: a.role })),
      timestamp: new Date().toISOString(),
    };
  }
}
