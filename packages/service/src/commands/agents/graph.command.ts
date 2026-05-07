import { z } from 'zod';
import type { ICommand, CommandRuntime, ITeamGraphBuilder } from '@ai-team/core';
import type { GraphData } from '@ai-team/api-contracts';

type Params = z.infer<typeof GraphCommand.schema>;

export class GraphCommand implements ICommand<Params, void, GraphData> {
  static readonly schema = z.object({
    mode: z.enum(['hierarchy', 'features', 'expertise', 'matrix']).optional().describe('View mode'),
  });

  readonly key = 'getTeamGraph';
  readonly cli = { command: 'graph' };
  readonly description = 'Generate team graph';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = GraphCommand.schema;

  constructor(private readonly teamGraphBuilder: ITeamGraphBuilder) {}

  async execute(payload: Params, _ctx: void, _runtime: CommandRuntime): Promise<GraphData> {
    try {
      return this.teamGraphBuilder.buildGraph(payload.mode ?? 'hierarchy');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`getTeamGraph failed: ${detail}`);
    }
  }
}
