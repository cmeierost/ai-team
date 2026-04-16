import { AgentManager, TeamGraphBuilder, ViewMode } from '@ai-team/infrastructure';

export async function getTeamGraphCommand(workspaceRoot: string, mode: ViewMode): Promise<Awaited<ReturnType<TeamGraphBuilder['buildGraph']>>> {
  const employeeManager = new AgentManager(workspaceRoot);

  const graphBuilder = new TeamGraphBuilder(employeeManager);
  return graphBuilder.buildGraph(mode);
}

export async function getOrganizationGraphCommand(workspaceRoot: string): Promise<ReturnType<TeamGraphBuilder['buildGraph']>> {
  return getTeamGraphCommand(workspaceRoot, 'hierarchy');
}
