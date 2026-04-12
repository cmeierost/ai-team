import type { ITeamGraphService, GraphData, ViewMode } from '@ai-team/api-client';
import { getTeamGraphCommand, getOrganizationGraphCommand } from '../commands/graph.js';

export class TeamService implements ITeamGraphService {
  constructor(private readonly workspaceRoot: string) {}

  async getTeamGraph(mode?: ViewMode): Promise<GraphData> {
    return getTeamGraphCommand(this.workspaceRoot, mode ?? 'hierarchy');
  }

  async getOrganizationGraph(): Promise<GraphData> {
    return getOrganizationGraphCommand(this.workspaceRoot);
  }
}
