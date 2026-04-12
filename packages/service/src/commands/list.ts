import { AgentManager } from '@ai-team/infrastructure';

import { Employee, ListEmployeesRequest } from '@ai-team/api-client';

export async function listEmployeesCommand(
  workspaceRoot: string,
  request: ListEmployeesRequest
): Promise<Employee[]> {
  const agentManager = new AgentManager(workspaceRoot);

  let employees = await agentManager.getAllAgentsAsync();

  if (request.role) {
    employees = employees.filter((employee) => employee.role === request.role);
  }

  if (request.feature) {
    const feature = request.feature;
    employees = employees.filter((employee) => employee.features?.includes(feature));
  }

  return employees;
}
