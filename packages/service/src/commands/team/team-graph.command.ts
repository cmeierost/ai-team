import { z } from 'zod';
import type {
  ICommand,
  ITeamGraphBuilder,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { GraphData } from '@ai-team/api-contracts';

type Params = z.infer<typeof GraphCommand.schema>;
const _graphCommandSchema = z.object({
  mode: z.enum(['hierarchy', 'features', 'expertise', 'matrix']).optional().describe('View mode'),
});

export const GraphCommandMetadata = {
  key: 'graph',
  description: 'Generate team graph',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'team',
  parameters: _graphCommandSchema,
} satisfies ICommandDescriptor;

export class GraphCommand implements ICommand<Params, GraphData> {
  static readonly schema = _graphCommandSchema;
  readonly metadata = GraphCommandMetadata;

  constructor(private readonly teamGraphBuilder: ITeamGraphBuilder) {}

  async execute(payload: Params, _ctx: ExecutionContext): Promise<CommandResponse<GraphData>> {
    const data = await this.teamGraphBuilder.buildGraph(payload.mode ?? 'hierarchy');
    return { status: 'ok', data };
  }
}
