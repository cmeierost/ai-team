import type { ITeamGraphBuilder, ViewMode, GraphData } from '@ai-team/core';

export async function getTeamGraphCommand(
  teamGraphBuilder: ITeamGraphBuilder,
  mode: ViewMode
): Promise<GraphData> {
  return teamGraphBuilder.buildGraph(mode);
}

export async function getOrganizationGraphCommand(
  teamGraphBuilder: ITeamGraphBuilder
): Promise<GraphData> {
  return getTeamGraphCommand(teamGraphBuilder, 'hierarchy');
}
