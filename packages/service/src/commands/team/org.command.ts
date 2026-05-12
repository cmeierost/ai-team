import type {
  ICommand,
  ITeamGraphBuilder,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { GraphData } from '@ai-team/api-contracts';

export class OrgCommand implements ICommand<Record<string, never>, GraphData> {
  readonly key = 'getOrganizationGraph';
  readonly cli = { command: 'org' };
  readonly description = 'Show organization hierarchy';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'team';

  constructor(private readonly teamGraphBuilder: ITeamGraphBuilder) {}

  async execute(
    _payload: Record<string, never>,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<GraphData>> {
    const data = await this.teamGraphBuilder.buildOrganizationGraph();
    return { status: 'ok', data };
  }
}
