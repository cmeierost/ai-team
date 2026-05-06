import type { IAgentManager } from '@ai-team/core';
import type { Employee, ListEmployeesRequest } from '@ai-team/api-contracts';

export class ListEmployeesCommand {
  constructor(private readonly agentManager: IAgentManager) {}

  async execute(request: ListEmployeesRequest): Promise<Employee[]> {
    let employees = await this.agentManager.getAllAgentsAsync();

    if (request.role) {
      employees = employees.filter((employee) => employee.role === request.role);
    }

    if (request.feature) {
      const feature = request.feature;
      employees = employees.filter((employee) => employee.features?.includes(feature));
    }

    return employees;
  }
}
