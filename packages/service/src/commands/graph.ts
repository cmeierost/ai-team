import { AgentManager, TeamGraphBuilder, ViewMode } from '@ai-team/core';

export async function getTeamGraphCommand(workspaceRoot: string, mode: ViewMode): Promise<ReturnType<TeamGraphBuilder['buildGraph']>> {
  const employeeManager = new AgentManager(workspaceRoot);
  await employeeManager.initialize();

  const graphBuilder = new TeamGraphBuilder(employeeManager);
  return graphBuilder.buildGraph(mode);
}

export async function getOrganizationGraphCommand(workspaceRoot: string): Promise<ReturnType<TeamGraphBuilder['buildGraph']>> {
  return getTeamGraphCommand(workspaceRoot, 'hierarchy');
}
