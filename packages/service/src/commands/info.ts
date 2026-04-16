import { AgentManager } from '@ai-team/infrastructure';

import { Employee } from '@ai-team/api-client';

export async function resolveEmployeesCommand(
  workspaceRoot: string,
  query: string
): Promise<Employee[]> {
  const employeeManager = new AgentManager(workspaceRoot);
  return employeeManager.resolveAgentAsync(query);
}
