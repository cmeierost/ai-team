import type { IAgentManager } from '@ai-team/core';
import type { Employee, ListEmployeesRequest } from '@ai-team/api-contracts';

export async function listEmployees(
  agentManager: IAgentManager,
  request: ListEmployeesRequest
): Promise<Employee[]> {
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
