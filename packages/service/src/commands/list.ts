import { AgentManager } from '@ai-team/core';

import { Employee, ListEmployeesRequest } from '../contracts.js';

export async function listEmployeesCommand(workspaceRoot: string, request: ListEmployeesRequest): Promise<Employee[]> {
  const agentManager = new AgentManager(workspaceRoot);
  await agentManager.initialize();

  let employees = agentManager.getAllAgents();

  if (request.role) {
    employees = employees.filter(employee => employee.role === request.role);
  }

  if (request.feature) {
    const feature = request.feature;
    employees = employees.filter(employee => employee.features?.includes(feature));
  }

  return employees;
}
