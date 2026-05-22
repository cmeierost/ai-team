import type {
  ICommand,
  ITeamGraphBuilder,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { GraphData } from '@ai-team/api-contracts';
export const OrgCommandMetadata = {
  key: 'org',
  description: 'Show organization hierarchy',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'team',
} satisfies ICommandDescriptor;

export class OrgCommand implements ICommand<Record<string, never>, GraphData> {
  readonly metadata = OrgCommandMetadata;

  constructor(private readonly teamGraphBuilder: ITeamGraphBuilder) {}

  async execute(
    _payload: Record<string, never>,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<GraphData>> {
    const data = await this.teamGraphBuilder.buildOrganizationGraph();
    return { status: 'ok', data };
  }
}
