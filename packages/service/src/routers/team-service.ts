import type { ITeamGraphService, GraphData, ViewMode } from '@ai-team/api-contracts';
import type { ITeamGraphBuilder } from '@ai-team/core';

export class TeamService implements ITeamGraphService {
  constructor(private readonly teamGraphBuilder: ITeamGraphBuilder) {}

  async getTeamGraph(mode?: ViewMode): Promise<GraphData> {
    return this.teamGraphBuilder.buildGraph(mode ?? 'hierarchy');
  }

  async getOrganizationGraph(): Promise<GraphData> {
    return this.teamGraphBuilder.buildOrganizationGraph();
  }
}
