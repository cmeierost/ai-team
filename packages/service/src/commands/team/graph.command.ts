import { z } from 'zod';
import type {
  ICommand,
  ITeamGraphBuilder,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { GraphData } from '@ai-team/api-contracts';

type Params = z.infer<typeof GraphCommand.schema>;

export class GraphCommand implements ICommand<Params, GraphData> {
  static readonly schema = z.object({
    mode: z.enum(['hierarchy', 'features', 'expertise', 'matrix']).optional().describe('View mode'),
  });

  readonly key = 'getTeamGraph';
  readonly cli = { command: 'graph' };
  readonly description = 'Generate team graph';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'team';
  readonly parameters = GraphCommand.schema;

  constructor(private readonly teamGraphBuilder: ITeamGraphBuilder) {}

  async execute(
    payload: Params,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<GraphData>> {
    const data = await this.teamGraphBuilder.buildGraph(payload.mode ?? 'hierarchy');
    return { status: 'ok', data };
  }
}
