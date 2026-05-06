import type { ITeamGraphService, GraphData, ViewMode } from '@ai-team/api-contracts';
import type { ITeamGraphBuilder } from '@ai-team/core';
import { getTeamGraphCommand, getOrganizationGraphCommand } from '../commands/graph.js';

export class TeamService implements ITeamGraphService {
  constructor(private readonly teamGraphBuilder: ITeamGraphBuilder) {}

  async getTeamGraph(mode?: ViewMode): Promise<GraphData> {
    return getTeamGraphCommand(this.teamGraphBuilder, mode ?? 'hierarchy');
  }

  async getOrganizationGraph(): Promise<GraphData> {
    return getOrganizationGraphCommand(this.teamGraphBuilder);
  }
}
