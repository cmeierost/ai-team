import { AgentManager } from '@ai-team/core';

import { Employee } from '../contracts.js';

export async function resolveEmployeesCommand(workspaceRoot: string, query: string): Promise<Employee[]> {
  const employeeManager = new AgentManager(workspaceRoot);
  await employeeManager.initialize();
  return employeeManager.resolveAgent(query);
}
