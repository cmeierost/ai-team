import type { ICommand, CommandRuntime, ITeamGraphBuilder } from '@ai-team/core';
import type { GraphData } from '@ai-team/api-contracts';

export class OrgCommand implements ICommand<Record<string, never>, void, GraphData> {
  readonly key = 'getOrganizationGraph';
  readonly cli = { command: 'org' };
  readonly description = 'Show organization hierarchy';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'team';

  constructor(private readonly teamGraphBuilder: ITeamGraphBuilder) {}

  async execute(
    _payload: Record<string, never>,
    _ctx: void,
    _runtime: CommandRuntime
  ): Promise<GraphData> {
    return this.teamGraphBuilder.buildOrganizationGraph();
  }
}
